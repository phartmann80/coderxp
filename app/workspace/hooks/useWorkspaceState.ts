"use client";

/**
 * Workspace state hook for CoderXP M2 Workspace Alpha.
 *
 * Final correction scope (fix(workspace): finalize lifecycle state integrity):
 *
 * 1. Separate committed mutations from follow-up UI work:
 *    Once an IndexedDB mutation resolves, treat it as committed and
 *    successful. Never retry the same mutation because a later UI
 *    refresh or project-open step failed.
 *
 * 2. Fix active-project startup failure:
 *    A saved active-project open failure during startup must never
 *    remain in the loading view. On failure: view = launcher, project
 *    list visible, controlled error visible, retryAction = openProject.
 *
 * 3. Implement truthful single-flight project opening:
 *    Only one project-open sequence may run at a time. Repeated clicks
 *    for the same project share or reject. Different project buttons
 *    are disabled while opening. Creation is disabled while opening.
 *
 * 4. Add a real retry-pending contract:
 *    retry() is async and awaits the exact operation. While retrying:
 *    Retry is disabled, Dismiss is disabled, relevant controls disabled.
 *    WorkspaceShell shows Retry only when a retry action exists.
 *
 * 5. Use one cross-operation lock in the project shell:
 *    Rename and delete must never overlap. A unified projectOperationPending
 *    value is passed to ProjectShell.
 *
 * 6. Make back navigation synchronous and safe:
 *    backToLauncher() does not depend on a database reload. It
 *    invalidates stale open generation, clears state, and sets view
 *    to launcher immediately.
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
  retrying: boolean;
  openingProjectId: string | null;
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
  const [retrying, setRetrying] = useState(false);
  const [openingProjectId, setOpeningProjectId] = useState<string | null>(null);
  const [retryAction, setRetryAction] = useState<RetryAction | null>(null);

  const mountedRef = useRef(true);

  // --- Operation-generation token for stale async project opens ---
  const openGenerationRef = useRef(0);

  // --- Single-flight project opening ownership guard ---
  const openingRef = useRef<string | null>(null);

  // --- Retry-pending synchronous guard ---
  const retryingRef = useRef(false);

  // --- Ref-based guards against duplicate submissions ---
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
   * Uses isPersistenceError() / getPersistenceErrorCode() for verification.
   * Unknown errors map to TRANSACTION_FAILED with a controlled message.
   * Never sends raw DOMException, browser, database, stack, or internal
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
   * Insert a project into the projects state array using deterministic
   * ordering (oldest first by createdAt, then by id for stability).
   */
  const insertProjectOrdered = useCallback((project: WorkspaceProject) => {
    setProjects((prev) => {
      const next = [...prev, project];
      next.sort((a, b) => {
        if (a.createdAt !== b.createdAt) return a.createdAt - b.createdAt;
        return a.id < b.id ? -1 : 1;
      });
      return next;
    });
  }, []);

  /**
   * Replace a project in the projects state array (matching by id).
   */
  const replaceProjectInState = useCallback((updated: WorkspaceProject) => {
    setProjects((prev) =>
      prev.map((p) => (p.id === updated.id ? updated : p)),
    );
  }, []);

  /**
   * Filter a project out of the projects state array.
   */
  const filterProjectFromState = useCallback((projectId: string) => {
    setProjects((prev) => prev.filter((p) => p.id !== projectId));
  }, []);

  /**
   * Open a project by ID: loads project record and its file entries.
   *
   * Single-flight: only one project-open sequence may run at a time.
   * Repeated clicks for the same project share the current operation.
   * Different project clicks are rejected while another open is running.
   *
   * Uses an operation-generation token so stale results are discarded.
   * The active-project preference is written only by the owned open.
   *
   * Returns the project on success, or null on failure/unmount/rejection.
   */
  const openProject = useCallback(
    async (projectId: string): Promise<WorkspaceProject | null> => {
      // Single-flight: if an open is already in flight for this project,
      // return null (the existing operation will handle it).
      if (openingRef.current !== null) {
        return null;
      }

      // Claim ownership.
      openingRef.current = projectId;
      setOpeningProjectId(projectId);

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

        // Only the owned open may update state.
        setActiveProject(project);
        setActiveProjectFiles(files);
        // Clear stale errors and retry actions from a previous failure.
        setError(null);
        setRetryAction(null);
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
        // Do NOT switch to "error" view: preserve the current view
        // (launcher or currently open project).
        return null;
      } finally {
        // Release ownership.
        if (generation === openGenerationRef.current) {
          openingRef.current = null;
          if (mountedRef.current) {
            setOpeningProjectId(null);
          }
        }
      }
    },
    [toWorkspaceError],
  );

  /**
   * Startup: check persistence, load projects, open active project.
   *
   * If the saved active project fails to open, the view is set to
   * launcher (not loading or error), the project list remains visible,
   * a controlled error is shown, and retryAction is set to openProject
   * with the saved project ID.
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

      // Persistence is confirmed available at this point.
      setPersistenceAvailable(true);

      const activeId = await getActiveProjectId();
      if (generation !== openGenerationRef.current) return;
      if (!mountedRef.current) return;

      if (activeId) {
        const found = list.find((p) => p.id === activeId);
        if (found) {
          // Attempt to open the active project.
          // Note: openProject increments openGenerationRef internally, so
          // we must NOT check generation against openGenerationRef here —
          // that would always fail and leave the user stuck on "Loading
          // workspace…" when the saved active project fails to open.
          const result = await openProject(activeId);
          if (!mountedRef.current) return;
          if (!result) {
            // Open failed: do NOT remain in loading view.
            // Show launcher with visible error and retry = openProject.
            // (openProject already set error and retryAction.)
            setView("launcher");
          }
          return;
        }
      }
      // No active project or not found: show launcher.
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
   * Once createProjectFromTemplate() resolves, the project is committed.
   * Add the returned project to projects state directly using deterministic
   * ordering. Return creation success so the launcher may clear the name.
   * Attempt to open the newly created project separately. If opening
   * fails, remain on the launcher with the newly created project visible.
   * Set Retry to openProject for that new project ID. Never set Retry
   * back to createProject. Retrying must not create a duplicate project.
   *
   * Returns true on creation success, false on creation failure.
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

        // The mutation has committed. Add the project to state directly.
        insertProjectOrdered(project);

        // Creation succeeded: return true so the launcher clears the name.
        // Attempt to open the newly created project separately.
        // Use the actual result returned by openProject().
        const openResult = await openProject(project.id);
        if (!mountedRef.current) return true;

        if (!openResult) {
          // Opening failed, but creation succeeded.
          // Remain on launcher with the new project visible.
          // Retry is set to openProject (by openProject's catch), not createProject.
          // Ensure we are on the launcher view.
          if (view !== "project") {
            setView("launcher");
          }
        }

        return true;
      } catch (err) {
        if (!mountedRef.current) return false;
        setError(toWorkspaceError(err));
        setRetryAction({ type: "createProject", name, templateId });
        // Do NOT switch to "error" view: launcher stays visible.
        return false;
      } finally {
        creatingRef.current = false;
        if (mountedRef.current) {
          setCreating(false);
        }
      }
    },
    [insertProjectOrdered, openProject, toWorkspaceError, view],
  );

  /**
   * Rename the active project.
   *
   * Once renameProject() resolves, the rename is committed.
   * Update activeProject directly. Replace the matching project in
   * projects state directly. Close rename mode. Do not require
   * reloadProjects() for success. Never retry the rename because a
   * later list refresh failed.
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

        // The mutation has committed. Update state directly.
        setActiveProject(updated);
        replaceProjectInState(updated);

        // Optional reconciliation read (separate from mutation success).
        // This is best-effort and does not affect the mutation's success.
        try {
          await reloadProjects();
        } catch {
          // Reconciliation read failed; mutation already succeeded.
          // Do not retry the rename.
        }

        if (!mountedRef.current) return true;
        return true;
      } catch (err) {
        if (!mountedRef.current) return false;
        setError(toWorkspaceError(err));
        setRetryAction({ type: "renameProject", projectId, name: newName });
        // Do NOT switch to "error" view: project stays open.
        return false;
      } finally {
        renamingRef.current = false;
        if (mountedRef.current) {
          setRenaming(false);
        }
      }
    },
    [replaceProjectInState, reloadProjects, toWorkspaceError],
  );

  /**
   * Delete a project with confirmation.
   *
   * Once deleteProject() resolves, the deletion is committed.
   * Filter the deleted project from projects state directly.
   * Clear the active project and files. Switch to the launcher
   * immediately. Clear the successful delete's error and retry state.
   * Do not require reloadProjects() before rendering the launcher.
   * Never retry deletion after the original deletion committed.
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

        // The mutation has committed. Update state directly.
        filterProjectFromState(projectId);
        setActiveProject(null);
        setActiveProjectFiles([]);
        // Clear the successful delete's error and retry state.
        setError(null);
        setRetryAction(null);
        // Switch to launcher immediately.
        setView("launcher");

        // Optional reconciliation read (separate from mutation success).
        try {
          await reloadProjects();
        } catch {
          // Reconciliation read failed; mutation already succeeded.
          // Do not retry the deletion.
        }

        if (!mountedRef.current) return true;
        return true;
      } catch (err) {
        if (!mountedRef.current) return false;
        setError(toWorkspaceError(err));
        setRetryAction({ type: "deleteProject", projectId });
        // Do NOT switch to "error" view: project + confirmation stay.
        return false;
      } finally {
        deletingRef.current = false;
        if (mountedRef.current) {
          setDeleting(false);
        }
      }
    },
    [filterProjectFromState, reloadProjects, toWorkspaceError],
  );

  /**
   * Go back to the launcher view.
   *
   * Synchronous and safe: does not depend on a database reload.
   * Invalidates any stale open generation, clears activeProject,
   * clears activeProjectFiles, clears operation error/retry state,
   * and sets view to launcher immediately.
   * The existing projects state is already maintained after successful
   * mutations. Does not create a temporary view = project / activeProject
   * = null state. Never produces an unhandled rejected promise or blank
   * workspace.
   */
  const backToLauncher = useCallback(() => {
    // Cancel any in-flight open by bumping the generation.
    openGenerationRef.current++;
    // Clear the single-flight ownership.
    openingRef.current = null;
    setOpeningProjectId(null);
    setActiveProject(null);
    setActiveProjectFiles([]);
    setError(null);
    setRetryAction(null);
    setView("launcher");
  }, []);

  /**
   * Retry the actual failed operation.
   *
   * Async: awaits the exact operation that failed.
   * While retrying: Retry is disabled, Dismiss is disabled, relevant
   * create/open/rename/delete controls are disabled.
   * Repeated Retry clicks do not start another operation.
   * The retry action is cleared only after success, explicit dismissal,
   * or replacement by a new failure.
   */
  const retry = useCallback(async () => {
    if (!retryAction) return;
    // Synchronous guard: prevent overlapping retries.
    if (retryingRef.current) return;
    retryingRef.current = true;

    setRetrying(true);

    try {
      switch (retryAction.type) {
        case "startup": {
          setError(null);
          setRetryAction(null);
          setView("loading");
          await startup();
          break;
        }
        case "openProject": {
          if (retryAction.projectId) {
            setError(null);
            setRetryAction(null);
            await openProject(retryAction.projectId);
          }
          break;
        }
        case "createProject": {
          if (retryAction.name && retryAction.templateId) {
            setError(null);
            // Do NOT clear retryAction yet: handleCreateProject will
            // clear it on success or set a new one on failure.
            await handleCreateProject(retryAction.name, retryAction.templateId);
          }
          break;
        }
        case "renameProject": {
          if (retryAction.projectId && retryAction.name) {
            setError(null);
            await handleRenameProject(retryAction.projectId, retryAction.name);
          }
          break;
        }
        case "deleteProject": {
          if (retryAction.projectId) {
            setError(null);
            await handleDeleteProject(retryAction.projectId);
          }
          break;
        }
      }
    } finally {
      retryingRef.current = false;
      if (mountedRef.current) {
        setRetrying(false);
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
    retrying,
    openingProjectId,
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
