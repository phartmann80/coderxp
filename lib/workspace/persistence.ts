/**
 * IndexedDB persistence layer for CoderXP M2 Workspace Alpha.
 *
 * Commit 2 scope: native IndexedDB persistence, typed errors, atomic
 * project and filesystem transactions, workspace path validation.
 *
 * Limitations documented as code contracts:
 * - IndexedDB unavailable: isWorkspacePersistenceAvailable() returns false;
 *   openWorkspaceDatabase() throws PERSISTENCE_UNAVAILABLE.
 * - Browser quota exceeded: mutations throw QUOTA_EXCEEDED with the
 *   original error preserved through `cause`.
 * - Database blocked by another tab: openWorkspaceDatabase() rejects with
 *   DATABASE_OPEN_FAILED; the blocked event is captured.
 * - Database version changed: the cached connection is closed and cleared
 *   on versionchange; the next open re-creates it.
 * - Transaction aborted: mutations throw TRANSACTION_FAILED with the
 *   original error preserved through `cause`.
 *
 * No UI messages are implemented in this commit. All failures surface as
 * typed PersistenceError instances for later UI handling.
 */

import {
  FILES_INDEX_BY_PROJECT,
  FILES_KEY_PATH,
  MAX_PROJECT_NAME_LENGTH,
  MIN_PROJECT_NAME_LENGTH,
  PREF_ACTIVE_PROJECT_ID,
  STORE_FILES,
  STORE_PREFERENCES,
  STORE_PROJECTS,
  WORKSPACE_DB_NAME,
  WORKSPACE_DB_VERSION,
} from "./constants";
import {
  normalizeAndValidateWorkspacePath,
  isDescendantPath,
  replacePathPrefix,
} from "./path-utils";
import {
  PersistenceError,
  type WorkspaceFileRecord,
  type WorkspacePreferenceRecord,
  type WorkspaceProject,
  type ProjectTemplateId,
} from "./types";

// ---------------------------------------------------------------------------
// Database connection lifecycle
// ---------------------------------------------------------------------------

/** Cached open database connection (singleton). */
let dbConnection: IDBDatabase | null = null;

/** Whether a connection open is in progress. */
let dbOpening = false;

/**
 * Returns true when IndexedDB is available in the current environment.
 * Checks for the API and a valid factory function.
 */
export function isWorkspacePersistenceAvailable(): boolean {
  try {
    return (
      typeof indexedDB !== "undefined" &&
      typeof indexedDB.open === "function"
    );
  } catch {
    return false;
  }
}

/**
 * Opens (or returns the cached) workspace database connection.
 *
 * Reuses one open connection. On failure, clears the cached connection.
 * Closes the database when versionchange fires. Handles blocked, error,
 * and upgradeneeded events.
 *
 * Does not delete or recreate an existing database on ordinary errors.
 * Does not use localStorage as a silent fallback.
 * Does not silently discard stored records.
 */
export function openWorkspaceDatabase(): Promise<IDBDatabase> {
  if (dbConnection) {
    return Promise.resolve(dbConnection);
  }

  if (dbOpening) {
    return Promise.reject(
      new PersistenceError("DATABASE_OPEN_FAILED", "Database open already in progress."),
    );
  }

  if (!isWorkspacePersistenceAvailable()) {
    return Promise.reject(
      new PersistenceError(
        "PERSISTENCE_UNAVAILABLE",
        "IndexedDB is not available in this environment.",
      ),
    );
  }

  dbOpening = true;

  return new Promise<IDBDatabase>((resolve, reject) => {
    let request: IDBOpenDBRequest;

    try {
      request = indexedDB.open(WORKSPACE_DB_NAME, WORKSPACE_DB_VERSION);
    } catch (error) {
      dbOpening = false;
      reject(
        new PersistenceError("DATABASE_OPEN_FAILED", "Failed to open database.", error),
      );
      return;
    }

    request.onupgradeneeded = (_event: IDBVersionChangeEvent) => {
      const db = request.result;

      // Create stores only when absent.
      if (!db.objectStoreNames.contains(STORE_PROJECTS)) {
        db.createObjectStore(STORE_PROJECTS, { keyPath: "id" });
      }

      if (!db.objectStoreNames.contains(STORE_FILES)) {
        const fileStore = db.createObjectStore(STORE_FILES, {
          keyPath: FILES_KEY_PATH,
        });
        if (!fileStore.indexNames.contains(FILES_INDEX_BY_PROJECT)) {
          fileStore.createIndex(FILES_INDEX_BY_PROJECT, "projectId", {
            unique: false,
          });
        }
      }

      if (!db.objectStoreNames.contains(STORE_PREFERENCES)) {
        db.createObjectStore(STORE_PREFERENCES, { keyPath: "key" });
      }
    };

    request.onsuccess = (_event: Event) => {
      const db = request.result;
      dbOpening = false;

      // Close and clear the cached connection when another tab upgrades.
      db.onversionchange = (_e: IDBVersionChangeEvent) => {
        db.close();
        if (dbConnection === db) {
          dbConnection = null;
        }
      };

      dbConnection = db;
      resolve(db);
    };

    request.onerror = (_event: Event) => {
      dbOpening = false;
      dbConnection = null;
      reject(
        new PersistenceError("DATABASE_OPEN_FAILED", "Database open request failed.", request.error),
      );
    };

    request.onblocked = (_event: IDBVersionChangeEvent) => {
      dbOpening = false;
      dbConnection = null;
      reject(
        new PersistenceError(
          "DATABASE_OPEN_FAILED",
          "Database open blocked by another tab or connection.",
        ),
      );
    };
  });
}

/**
 * Closes the cached database connection and clears the reference.
 * Safe to call when no connection is open.
 */
export function closeWorkspaceDatabase(): void {
  if (dbConnection) {
    dbConnection.close();
    dbConnection = null;
  }
  dbOpening = false;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Wraps an IDBRequest in a Promise that resolves with the result
 * or rejects with a PersistenceError.
 */
function wrapRequest<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => {
      const error = request.error;
      if (error && error.name === "QuotaExceededError") {
        reject(new PersistenceError("QUOTA_EXCEEDED", "Storage quota exceeded.", error));
      } else {
        reject(new PersistenceError("TRANSACTION_FAILED", "Request failed.", error));
      }
    };
  });
}

/**
 * Wraps an IDBTransaction in a Promise that resolves on complete
 * or rejects on error/abort.
 */
function wrapTransaction(tx: IDBTransaction): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => {
      const error = tx.error;
      if (error && error.name === "QuotaExceededError") {
        reject(new PersistenceError("QUOTA_EXCEEDED", "Storage quota exceeded.", error));
      } else {
        reject(new PersistenceError("TRANSACTION_FAILED", "Transaction failed.", error));
      }
    };
    tx.onabort = () => {
      const error = tx.error;
      if (error && error.name === "QuotaExceededError") {
        reject(new PersistenceError("QUOTA_EXCEEDED", "Storage quota exceeded.", error));
      } else {
        reject(new PersistenceError("TRANSACTION_FAILED", "Transaction aborted.", error));
      }
    };
  });
}

/** Returns the current Unix timestamp in milliseconds. */
function now(): number {
  return Date.now();
}

/**
 * Validates a project name. Must be trimmed and non-empty, within length limits.
 * Throws INVALID_PROJECT_NAME on failure.
 */
function validateProjectName(name: string): void {
  const trimmed = name.trim();
  if (trimmed.length < MIN_PROJECT_NAME_LENGTH) {
    throw new PersistenceError("INVALID_PROJECT_NAME", "Project name must not be empty.");
  }
  if (trimmed.length > MAX_PROJECT_NAME_LENGTH) {
    throw new PersistenceError(
      "INVALID_PROJECT_NAME",
      `Project name exceeds maximum length of ${MAX_PROJECT_NAME_LENGTH} characters.`,
    );
  }
}

// ---------------------------------------------------------------------------
// Project operations
// ---------------------------------------------------------------------------

/**
 * Creates a new project with a unique ID and the given template.
 * Returns the created project record.
 */
export async function createProject(
  name: string,
  templateId: ProjectTemplateId,
): Promise<WorkspaceProject> {
  validateProjectName(name);

  const db = await openWorkspaceDatabase();

  const project: WorkspaceProject = {
    id: crypto.randomUUID(),
    name: name.trim(),
    templateId,
    activeFile: null,
    openTabs: [],
    createdAt: now(),
    updatedAt: now(),
    revision: 1,
  };

  const tx = db.transaction(STORE_PROJECTS, "readwrite");
  const store = tx.objectStore(STORE_PROJECTS);
  store.add(project);

  await wrapTransaction(tx);
  return project;
}

/**
 * Retrieves a project by ID. Throws PROJECT_NOT_FOUND if absent.
 */
export async function getProject(projectId: string): Promise<WorkspaceProject> {
  const db = await openWorkspaceDatabase();

  const tx = db.transaction(STORE_PROJECTS, "readonly");
  const store = tx.objectStore(STORE_PROJECTS);
  const result = await wrapRequest(store.get(projectId) as IDBRequest<WorkspaceProject | undefined>);

  if (!result) {
    throw new PersistenceError("PROJECT_NOT_FOUND", `Project not found: ${projectId}`);
  }

  return result;
}

/**
 * Lists all projects ordered by creation time (oldest first).
 */
export async function listProjects(): Promise<WorkspaceProject[]> {
  const db = await openWorkspaceDatabase();

  const tx = db.transaction(STORE_PROJECTS, "readonly");
  const store = tx.objectStore(STORE_PROJECTS);
  const all = await wrapRequest(store.getAll() as IDBRequest<WorkspaceProject[]>);

  return all.sort((a, b) => a.createdAt - b.createdAt);
}

/**
 * Updates a project record. Increments the revision.
 * Returns the updated project.
 */
export async function updateProject(
  project: WorkspaceProject,
): Promise<WorkspaceProject> {
  const db = await openWorkspaceDatabase();

  const updated: WorkspaceProject = {
    ...project,
    updatedAt: now(),
    revision: project.revision + 1,
  };

  const tx = db.transaction(STORE_PROJECTS, "readwrite");
  const store = tx.objectStore(STORE_PROJECTS);
  store.put(updated);

  await wrapTransaction(tx);
  return updated;
}

/**
 * Renames a project. Validates the new name, increments revision.
 * Returns the updated project.
 */
export async function renameProject(
  projectId: string,
  newName: string,
): Promise<WorkspaceProject> {
  validateProjectName(newName);

  const project = await getProject(projectId);
  project.name = newName.trim();

  return updateProject(project);
}

/**
 * Deletes a project and all associated data in one atomic transaction.
 *
 * Removes:
 * - The project record
 * - Every associated file/directory record
 * - activeProjectId preference when it references the deleted project
 *
 * No orphaned file records are allowed.
 */
export async function deleteProject(projectId: string): Promise<void> {
  const db = await openWorkspaceDatabase();

  const tx = db.transaction(
    [STORE_PROJECTS, STORE_FILES, STORE_PREFERENCES],
    "readwrite",
  );

  // Delete the project record.
  tx.objectStore(STORE_PROJECTS).delete(projectId);

  // Delete all file records for this project via the byProject index.
  const fileStore = tx.objectStore(STORE_FILES);
  const index = fileStore.index(FILES_INDEX_BY_PROJECT);
  const fileKeys = await wrapRequest(index.getAllKeys(projectId) as IDBRequest<IDBValidKey[]>);

  for (const key of fileKeys) {
    fileStore.delete(key);
  }

  // Delete activeProjectId preference if it references this project.
  const prefStore = tx.objectStore(STORE_PREFERENCES);
  const pref = await wrapRequest(
    prefStore.get(PREF_ACTIVE_PROJECT_ID) as IDBRequest<WorkspacePreferenceRecord | undefined>,
  );
  if (pref && pref.value === projectId) {
    prefStore.delete(PREF_ACTIVE_PROJECT_ID);
  }

  await wrapTransaction(tx);
}

// ---------------------------------------------------------------------------
// File operations
// ---------------------------------------------------------------------------

/**
 * Retrieves a single file or directory entry by project ID and path.
 * Throws ENTRY_NOT_FOUND if absent.
 */
export async function getEntry(
  projectId: string,
  path: string,
): Promise<WorkspaceFileRecord> {
  const db = await openWorkspaceDatabase();

  const normalisedPath = normalizeAndValidateWorkspacePath(path);

  const tx = db.transaction(STORE_FILES, "readonly");
  const store = tx.objectStore(STORE_FILES);
  const result = await wrapRequest(
    store.get([projectId, normalisedPath]) as IDBRequest<WorkspaceFileRecord | undefined>,
  );

  if (!result) {
    throw new PersistenceError("ENTRY_NOT_FOUND", `Entry not found: ${normalisedPath}`);
  }

  return result;
}

/**
 * Lists all file and directory entries for a project, ordered by path.
 */
export async function listProjectEntries(
  projectId: string,
): Promise<WorkspaceFileRecord[]> {
  const db = await openWorkspaceDatabase();

  const tx = db.transaction(STORE_FILES, "readonly");
  const store = tx.objectStore(STORE_FILES);
  const index = store.index(FILES_INDEX_BY_PROJECT);
  const all = await wrapRequest(
    index.getAll(projectId) as IDBRequest<WorkspaceFileRecord[]>,
  );

  return all.sort((a, b) => a.path.localeCompare(b.path));
}

/**
 * Creates or updates a file or directory entry.
 *
 * File records require contents. Directory records must not store contents.
 * Paths are normalised before storage. Rejects conflicts before mutation.
 */
export async function putEntry(
  projectId: string,
  path: string,
  kind: "file" | "directory",
  contents?: string,
): Promise<WorkspaceFileRecord> {
  const db = await openWorkspaceDatabase();

  const normalisedPath = normalizeAndValidateWorkspacePath(path);

  // Validate entry constraints.
  if (kind === "file" && contents === undefined) {
    throw new PersistenceError("INVALID_ENTRY", "File entries require contents.");
  }
  if (kind === "directory" && contents !== undefined) {
    throw new PersistenceError("INVALID_ENTRY", "Directory entries must not have contents.");
  }

  const tx = db.transaction([STORE_FILES, STORE_PROJECTS], "readwrite");
  const fileStore = tx.objectStore(STORE_FILES);
  const projectStore = tx.objectStore(STORE_PROJECTS);

  // Check for existing entry.
  const existing = await wrapRequest(
    fileStore.get([projectId, normalisedPath]) as IDBRequest<WorkspaceFileRecord | undefined>,
  );

  // Conflict: cannot put a file where a directory exists, or vice versa.
  if (existing && existing.kind !== kind) {
    throw new PersistenceError(
      "ENTRY_CONFLICT",
      `An entry of a different kind already exists at: ${normalisedPath}`,
    );
  }

  const timestamp = now();
  const record: WorkspaceFileRecord = {
    projectId,
    path: normalisedPath,
    kind,
    contents: kind === "file" ? contents : undefined,
    createdAt: existing ? existing.createdAt : timestamp,
    updatedAt: timestamp,
  };

  fileStore.put(record);

  // Update project revision.
  const project = await wrapRequest(
    projectStore.get(projectId) as IDBRequest<WorkspaceProject | undefined>,
  );
  if (project) {
    project.updatedAt = timestamp;
    project.revision += 1;
    projectStore.put(project);
  }

  await wrapTransaction(tx);
  return record;
}

/**
 * Deletes a file or directory entry. When the entry is a directory,
 * atomically deletes the directory and all descendants in one transaction.
 *
 * The same transaction updates the project: activeFile, openTabs, updatedAt, revision.
 * Deleted paths are removed from activeFile and openTabs.
 */
export async function deleteEntry(
  projectId: string,
  path: string,
): Promise<void> {
  const db = await openWorkspaceDatabase();

  const normalisedPath = normalizeAndValidateWorkspacePath(path);

  const tx = db.transaction([STORE_FILES, STORE_PROJECTS], "readwrite");
  const fileStore = tx.objectStore(STORE_FILES);
  const projectStore = tx.objectStore(STORE_PROJECTS);

  // Get the entry to determine if it's a file or directory.
  const entry = await wrapRequest(
    fileStore.get([projectId, normalisedPath]) as IDBRequest<WorkspaceFileRecord | undefined>,
  );

  if (!entry) {
    throw new PersistenceError("ENTRY_NOT_FOUND", `Entry not found: ${normalisedPath}`);
  }

  // Collect all paths to delete.
  const pathsToDelete: string[] = [normalisedPath];

  if (entry.kind === "directory") {
    // Find all descendants.
    const allEntries = await wrapRequest(
      fileStore.index(FILES_INDEX_BY_PROJECT).getAll(projectId) as IDBRequest<WorkspaceFileRecord[]>,
    );
    for (const e of allEntries) {
      if (isDescendantPath(normalisedPath, e.path)) {
        pathsToDelete.push(e.path);
      }
    }
  }

  // Delete all collected paths.
  for (const p of pathsToDelete) {
    fileStore.delete([projectId, p]);
  }

  // Update project: remove deleted paths from activeFile and openTabs.
  const project = await wrapRequest(
    projectStore.get(projectId) as IDBRequest<WorkspaceProject | undefined>,
  );
  if (project) {
    const deletedSet = new Set(pathsToDelete);
    if (project.activeFile && deletedSet.has(project.activeFile)) {
      project.activeFile = null;
    }
    project.openTabs = project.openTabs.filter((tab) => !deletedSet.has(tab));
    project.updatedAt = now();
    project.revision += 1;
    projectStore.put(project);
  }

  await wrapTransaction(tx);
}

/**
 * Renames a file or directory entry. When the entry is a directory,
 * atomically updates the directory path and every descendant path.
 *
 * The same transaction updates: activeFile, every affected openTabs path,
 * project updatedAt, project revision.
 *
 * Checks every destination path for conflicts before writing any changes.
 * If any operation fails, the entire transaction aborts.
 */
export async function renameEntry(
  projectId: string,
  oldPath: string,
  newPath: string,
): Promise<void> {
  const db = await openWorkspaceDatabase();

  const normalisedOldPath = normalizeAndValidateWorkspacePath(oldPath);
  const normalisedNewPath = normalizeAndValidateWorkspacePath(newPath);

  // Reject renaming a directory into itself or one of its descendants.
  if (normalisedOldPath === normalisedNewPath) {
    throw new PersistenceError("INVALID_PATH", "New path must differ from old path.");
  }
  if (isDescendantPath(normalisedOldPath, normalisedNewPath)) {
    throw new PersistenceError(
      "INVALID_PATH",
      "Cannot rename a directory into itself or one of its descendants.",
    );
  }

  const tx = db.transaction([STORE_FILES, STORE_PROJECTS], "readwrite");
  const fileStore = tx.objectStore(STORE_FILES);
  const projectStore = tx.objectStore(STORE_PROJECTS);

  // Get the entry to rename.
  const entry = await wrapRequest(
    fileStore.get([projectId, normalisedOldPath]) as IDBRequest<WorkspaceFileRecord | undefined>,
  );

  if (!entry) {
    throw new PersistenceError("ENTRY_NOT_FOUND", `Entry not found: ${normalisedOldPath}`);
  }

  // Collect all entries to move (the entry itself + descendants if directory).
  const entriesToMove: WorkspaceFileRecord[] = [entry];
  if (entry.kind === "directory") {
    const allEntries = await wrapRequest(
      fileStore.index(FILES_INDEX_BY_PROJECT).getAll(projectId) as IDBRequest<WorkspaceFileRecord[]>,
    );
    for (const e of allEntries) {
      if (isDescendantPath(normalisedOldPath, e.path)) {
        entriesToMove.push(e);
      }
    }
  }

  // Check every destination path for conflicts before writing any changes.
  for (const e of entriesToMove) {
    const destPath = replacePathPrefix(e.path, normalisedOldPath, normalisedNewPath);
    const existing = await wrapRequest(
      fileStore.get([projectId, destPath]) as IDBRequest<WorkspaceFileRecord | undefined>,
    );
    // Conflict if a different entry (not one we're moving) exists at the destination.
    if (existing && !entriesToMove.some((m) => m.path === existing.path)) {
      throw new PersistenceError("ENTRY_CONFLICT", `Destination path already exists: ${destPath}`);
    }
  }

  // All conflict checks passed. Now perform the moves.
  const timestamp = now();
  const oldPaths = new Set(entriesToMove.map((e) => e.path));

  for (const e of entriesToMove) {
    const destPath = replacePathPrefix(e.path, normalisedOldPath, normalisedNewPath);
    // Delete the old key and put the new one.
    fileStore.delete([projectId, e.path]);
    fileStore.put({
      ...e,
      path: destPath,
      updatedAt: timestamp,
    });
  }

  // Update project: activeFile, openTabs, updatedAt, revision.
  const project = await wrapRequest(
    projectStore.get(projectId) as IDBRequest<WorkspaceProject | undefined>,
  );
  if (project) {
    if (project.activeFile && oldPaths.has(project.activeFile)) {
      project.activeFile = replacePathPrefix(project.activeFile, normalisedOldPath, normalisedNewPath);
    }
    project.openTabs = project.openTabs.map((tab) =>
      oldPaths.has(tab) ? replacePathPrefix(tab, normalisedOldPath, normalisedNewPath) : tab,
    );
    project.updatedAt = timestamp;
    project.revision += 1;
    projectStore.put(project);
  }

  await wrapTransaction(tx);
}

// ---------------------------------------------------------------------------
// Preference operations
// ---------------------------------------------------------------------------

/**
 * Gets a workspace preference by key. Returns undefined if not found.
 */
export async function getPreference(
  key: string,
): Promise<WorkspacePreferenceRecord | undefined> {
  const db = await openWorkspaceDatabase();

  const tx = db.transaction(STORE_PREFERENCES, "readonly");
  const store = tx.objectStore(STORE_PREFERENCES);
  return wrapRequest(store.get(key) as IDBRequest<WorkspacePreferenceRecord | undefined>);
}

/**
 * Sets a workspace preference. Creates or updates the record.
 */
export async function setPreference(
  key: string,
  value: unknown,
): Promise<void> {
  const db = await openWorkspaceDatabase();

  const tx = db.transaction(STORE_PREFERENCES, "readwrite");
  const store = tx.objectStore(STORE_PREFERENCES);
  store.put({ key, value } satisfies WorkspacePreferenceRecord);

  await wrapTransaction(tx);
}

/**
 * Gets the active project ID from preferences, or undefined.
 */
export async function getActiveProjectId(): Promise<string | undefined> {
  const pref = await getPreference(PREF_ACTIVE_PROJECT_ID);
  return pref?.value as string | undefined;
}

/**
 * Sets the active project ID preference.
 */
export async function setActiveProjectId(projectId: string): Promise<void> {
  await setPreference(PREF_ACTIVE_PROJECT_ID, projectId);
}
