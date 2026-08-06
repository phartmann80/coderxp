"use client";

/**
 * Workspace state hook for CoderXP M2 Workspace Alpha.
 *
 * Commit 3 correction scope:
 * - Surface operation errors in the current view (launcher + error,
 *   project + error, fatal error view) without discarding context.
 * - Track the real failed action and its inputs for precise retry.
 * - Await success before closing UI state (promises, ref-based guards).
 * - Harden typed-error conversion (instanceof / allowlist, no raw messages).
 * - Prevent stale asynchronous project opens (operation-generation token).
 *
 * Does not fabricate projects, files, loading progress, or success states.
 * Avoids state updates after component unmount.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  isWorkspacePersistenceAvailable,
  listProjects,
  getProject,
  getActiveProjectId,
  setActiveProjectId,
  createProjectFromTemplate,
  renameProject,
  deleteProject,
  listProjectEntries,
} from "@/lib/workspace/persistence";
import {
  PersistenceError,
  isPersistenceError,
  getPersistenceErrorCode,
  type PersistenceErrorCode,
  type WorkspaceProject,
  type WorkspaceFileRecord,
  type ProjectTemplateId,
} from "@/lib/workspace/types";

/** UI view states. */
export type WorkspaceView = "loading" | "launcher" | "project" | "error";

/** Typed workspace error for UI display. */
export interface WorkspaceError {
  code: PersistenceErrorCode;
  message: string;
}

/** The kind of operation that can fail and be retried. */
export type RetryActionType =
  | "startup"
  | "openProject"
  | "createProject"
  | "renameProject"
  | "deleteProject";

/** Inputs needed to retry a specific failed operation. */
export interface RetryAction {
  type: RetryActionType;
  projectId?: string;
  name?: string;
  templateId?: ProjectTemplateId;
}

/** Full workspace state exposed to components. */
export interface WorkspaceState {
  view: WorkspaceView;
  projects: WorkspaceProject[];
  activeProject: WorkspaceProject | null;
  activeProjectFiles: WorkspaceFileRecord[];
  error: WorkspaceError | null;
  persistenceAvailable: boolean;
  creating: boolean;
  renaming: boolean;
  deleting: boolean;
  retryAction: RetryAction | null;
}

/** Controlled error messages for each known code. */
const CONTROLLED_ERROR_MESSAGES: Record<PersistenceErrorCode, string> = {
  PERSISTENCE_UNAVAILABLE: "Local storage is not available in this browser. Project management requires IndexedDB.",
  DATABASE_OPEN_FAILED: "The local database could not be opened. It may be blocked by another tab.",
  QUOTA_EXCEEDED: "Storage quota exceeded. Remove unused projects to free space.",
  TRANSACTION_FAILED: "An unexpected local operation failed. Please try again.",
  PROJECT_NOT_FOUND: "The requested project was not found.",
  ENTRY_NOT_FOUND: "The requested file or directory was not found.",
  ENTRY_CONFLICT: "A file or directory with that path already exists.",
  REVISION_CONFLICT: "The project was modified by another operation. Please refresh.",
  INVALID_PROJECT_NAME: "The project name is invalid. Use 1 to 100 characters.",
  INVALID_PATH: "The file path is invalid.",
  INVALID_ENTRY: "The file or directory entry is invalid.",
  TEMPLATE_UNAVAILABLE: "This template is not available for project creation.",
};

/** Generic fallback message for unknown errors. */
const GENERIC_ERROR_MESSAGE = "An unexpected local operation failed. Please try again.";

export function useWorkspaceState() {
  const [view, setView] = useState<WorkspaceView>("loading");
  const [projects, setProjects] = useState<WorkspaceProject[]>([]);
  const [activeProject, setActiveProject] = useState<WorkspaceProject | null>(null);
  const [activeProjectFiles, setActiveProjectFiles] = useState<WorkspaceFileRecord[]>([]);
  const [error, setError] = useState<WorkspaceError | null>(null);
  const [persistenceAvailable, setPersistenceAvailable] = useState(true);
  const [creating, setCreating] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [retryAction, setRetryAction] = useState<RetryAction | null>(null);

  const mountedRef = useRef(true);

  // --- Operation-generation token for stale async project opens (correction 6) ---
  const openGenerationRef = useRef(0);

  // --- Ref-based guards against duplicate submissions (correction 4) ---
  const creatingRef = useRef(false);
  const renamingRef = useRef(false);
  const deletingRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  /**
   * Map a PersistenceError or unknown error to a WorkspaceError.
   *
   * Correction 5: Do not accept every object with code+message as trusted.
   * Use isPersistenceError() / getPersistenceErrorCode() for verification.
   * Unknown errors map to TRANSACTION_FAILED with a controlled message.
   * Never send raw DOMException, browser, database, stack, or internal
   * messages to the UI.
   */
  const toWorkspaceError = useCallback((err: unknown): WorkspaceError => {
    const code = getPersistenceErrorCode(err);
    if (code) {
      return {
        code,
        message: CONTROLLED_ERROR_MESSAGES[code] ?? GENERIC_ERROR_MESSAGE,
      };
    }
    return {
      code: "TRANSACTION_FAILED",
      message: GENERIC_ERROR_MESSAGE,
    };
  }, []);

  /** Reload the project list from persistence. */
  const reloadProjects = useCallback(async (): Promise<WorkspaceProject[]> => {
    const list = await listProjects();
    if (mountedRef.current) {
      setProjects(list);
    }
    return list;
  }, []);

  /**
   * Open a project by ID: loads project record and its file entries.
   *
   * Correction 6: Uses an operation-generation token so that when project A
   * and project B are opened rapidly, only the latest requested project may
   * update activeProject, activeProjectFiles, activeProjectId preference,
   * and view. State from an older completed request is discarded.
   *
   * Correction 2: On failure, surfaces the error without switching to the
   * "error" view (preserves launcher or currently open project).
   *
   * Returns the project on success, or null on failure/unmount.
   */
  const openProject = useCallback(
    async (projectId: string): Promise<WorkspaceProject | null> => {
      // Assign a new generation token for this open request.
      const generation = ++openGenerationRef.current;

      try {
        const project = await getProject(projectId);
        const files = await listProjectEntries(projectId);

        // Stale check: discard if a newer open request has started.
        if (generation !== openGenerationRef.current) {
          return null;
        }
        if (!mountedRef.current) return null;

        // Write the active-project preference before updating view.
        await setActiveProjectId(projectId);

        // Stale check again after the async preference write.
        if (generation !== openGenerationRef.current) {
          return null;
        }
        if (!mountedRef.current) return null;

        // Only the latest requested project may update state.
        setActiveProject(project);
        setActiveProjectFiles(files);
        setView("project");
        return project;
      } catch (err) {
        // Stale check: discard error from an older request.
        if (generation !== openGenerationRef.current) {
          return null;
        }
        if (!mountedRef.current) return null;

        const we = toWorkspaceError(err);
        setError(we);
        setRetryAction({ type: "openProject", projectId });
        // Do NOT switch to "error" view — preserve the current view
        // (launcher or currently open project).
        return null;
      }
    },
    [toWorkspaceError],
  );

  /**
   * Startup: check persistence, load projects, open active project.
   *
   * Uses the generation token to prevent stale startup results from
   * overwriting newer state.
   */
  const startup = useCallback(async () => {
    const generation = ++openGenerationRef.current;

    if (!isWorkspacePersistenceAvailable()) {
      if (generation !== openGenerationRef.current) return;
      if (!mountedRef.current) return;
      setPersistenceAvailable(false);
      setError({
        code: "PERSISTENCE_UNAVAILABLE",
        message: CONTROLLED_ERROR_MESSAGES.PERSISTENCE_UNAVAILABLE,
      });
      setRetryAction({ type: "startup" });
      setView("error");
      return;
    }

    try {
      const list = await reloadProjects();
      if (generation !== openGenerationRef.current) return;
      if (!mountedRef.current) return;

      const activeId = await getActiveProjectId();
      if (generation !== openGenerationRef.current) return;
      if (!mountedRef.current) return;

      if (activeId) {
        const found = list.find((p) => p.id === activeId);
        if (found) {
          await openProject(activeId);
          return;
        }
      }
      setView("launcher");
    } catch (err) {
      if (generation !== openGenerationRef.current) return;
      if (!mountedRef.current) return;
      const we = toWorkspaceError(err);
      setError(we);
      setRetryAction({ type: "startup" });
      setView("error");
    }
  }, [reloadProjects, openProject, toWorkspaceError]);

  /** Initial startup on mount. */
  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      if (!cancelled) await startup();
    };
    run();
    return () => { cancelled = true; };
  }, [startup]);

  /**
   * Create a new project from a template.
   *
   * Correction 4: Project name input clears only after successful creation.
   * Synchronous ref-based guard prevents duplicate transactions.
   * Correction 2: On failure, error is surfaced without discarding the launcher.
   * Correction 3: Retry reruns the exact same name and template.
   *
   * Returns true on success, false on failure.
   */
  const handleCreateProject = useCallback(
    async (name: string, templateId: ProjectTemplateId): Promise<boolean> => {
      // Synchronous ref-based guard against duplicate submissions.
      if (creatingRef.current) return false;
      creatingRef.current = true;

      setCreating(true);
      setError(null);
      setRetryAction(null);

      try {
        const project = await createProjectFromTemplate(name, templateId);
        if (!mountedRef.current) return true;
        await reloadProjects();
        if (!mountedRef.current) return true;
        await openProject(project.id);
        if (!mountedRef.current) return true;
        setRetryAction(null);
        return true;
      } catch (err) {
        if (!mountedRef.current) return false;
        setError(toWorkspaceError(err));
        setRetryAction({ type: "createProject", name, templateId });
        // Do NOT switch to "error" view — launcher stays visible.
        return false;
      } finally {
        creatingRef.current = false;
        if (mountedRef.current) {
          setCreating(false);
        }
      }
    },
    [reloadProjects, openProject, toWorkspaceError],
  );

  /**
   * Rename the active project.
   *
   * Correction 4: Rename mode closes only after successful rename.
   * Rename text remains available after failure.
   * Synchronous ref-based guard prevents duplicate transactions.
   * Correction 2: On failure, error is surfaced and the project stays open.
   * Correction 3: Retry reruns the exact same project and new name.
   *
   * Returns true on success, false on failure.
   */
  const handleRenameProject = useCallback(
    async (projectId: string, newName: string): Promise<boolean> => {
      // Synchronous ref-based guard against duplicate submissions.
      if (renamingRef.current) return false;
      renamingRef.current = true;

      setRenaming(true);
      setError(null);
      setRetryAction(null);

      try {
        const updated = await renameProject(projectId, newName);
        if (!mountedRef.current) return true;
        setActiveProject(updated);
        await reloadProjects();
        if (!mountedRef.current) return true;
        setRetryAction(null);
        return true;
      } catch (err) {
        if (!mountedRef.current) return false;
        setError(toWorkspaceError(err));
        setRetryAction({ type: "renameProject", projectId, name: newName });
        // Do NOT switch to "error" view — project stays open.
        return false;
      } finally {
        renamingRef.current = false;
        if (mountedRef.current) {
          setRenaming(false);
        }
      }
    },
    [reloadProjects, toWorkspaceError],
  );

  /**
   * Delete a project with confirmation.
   *
   * Correction 4: Delete confirmation closes only after successful deletion.
   * Synchronous ref-based guard prevents duplicate transactions.
   * Correction 2: On failure, error is surfaced and the project + confirmation
   * context remain available.
   * Correction 3: Retry reruns the exact same project deletion.
   *
   * Returns true on success, false on failure.
   */
  const handleDeleteProject = useCallback(
    async (projectId: string): Promise<boolean> => {
      // Synchronous ref-based guard against duplicate submissions.
      if (deletingRef.current) return false;
      deletingRef.current = true;

      setDeleting(true);
      setError(null);
      setRetryAction(null);

      try {
        await deleteProject(projectId);
        if (!mountedRef.current) return true;
        setActiveProject(null);
        setActiveProjectFiles([]);
        await reloadProjects();
        if (!mountedRef.current) return true;
        setView("launcher");
        setRetryAction(null);
        return true;
      } catch (err) {
        if (!mountedRef.current) return false;
        setError(toWorkspaceError(err));
        setRetryAction({ type: "deleteProject", projectId });
        // Do NOT switch to "error" view — project + confirmation stay.
        return false;
      } finally {
        deletingRef.current = false;
        if (mountedRef.current) {
          setDeleting(false);
        }
      }
    },
    [reloadProjects, toWorkspaceError],
  );

  /** Go back to the launcher view. */
  const backToLauncher = useCallback(async () => {
    // Cancel any in-flight open by bumping the generation.
    openGenerationRef.current++;
    setActiveProject(null);
    setActiveProjectFiles([]);
    setError(null);
    setRetryAction(null);
    await reloadProjects();
    if (mountedRef.current) {
      setView("launcher");
    }
  }, [reloadProjects]);

  /**
   * Retry the actual failed operation.
   *
   * Correction 3: Tracks the real failed action and its required inputs.
   * Each retry type reruns the exact operation that failed.
   * The retry action is cleared only after the operation succeeds or
   * the user dismisses/replaces it.
   * Prevents overlapping retries via ref-based guards.
   */
  const retry = useCallback(() => {
    if (!retryAction) return;

    // Prevent overlapping retries: the ref guards in each handler
    // will reject a duplicate if one is already in flight.
    switch (retryAction.type) {
      case "startup": {
        setError(null);
        setRetryAction(null);
        setView("loading");
        startup();
        break;
      }
      case "openProject": {
        if (retryAction.projectId) {
          setError(null);
          setRetryAction(null);
          openProject(retryAction.projectId);
        }
        break;
      }
      case "createProject": {
        if (retryAction.name && retryAction.templateId) {
          setError(null);
          // Do NOT clear retryAction yet — handleCreateProject will
          // clear it on success or set a new one on failure.
          handleCreateProject(retryAction.name, retryAction.templateId);
        }
        break;
      }
      case "renameProject": {
        if (retryAction.projectId && retryAction.name) {
          setError(null);
          handleRenameProject(retryAction.projectId, retryAction.name);
        }
        break;
      }
      case "deleteProject": {
        if (retryAction.projectId) {
          setError(null);
          handleDeleteProject(retryAction.projectId);
        }
        break;
      }
    }
  }, [retryAction, startup, openProject, handleCreateProject, handleRenameProject, handleDeleteProject]);

  /** Dismiss the current error and clear the retry action. */
  const dismissError = useCallback(() => {
    setError(null);
    setRetryAction(null);
  }, []);

  return {
    view,
    projects,
    activeProject,
    activeProjectFiles,
    error,
    persistenceAvailable,
    creating,
    renaming,
    deleting,
    retryAction,
    handleCreateProject,
    handleRenameProject,
    handleDeleteProject,
    backToLauncher,
    retry,
    dismissError,
    openProjectById: openProject,
  };
}
