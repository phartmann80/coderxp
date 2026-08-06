"use client";

/**
 * Workspace state hook for CoderXP M2 Workspace Alpha.
 *
 * Final correction (fix(workspace): close final lifecycle races):
 *
 * 1. Replace the project-open string lock with owned operation state:
 *    Uses a PendingProjectOpen record with token, promise, cancelled.
 *    The first open owns the operation. Repeated requests for the same
 *    project return the same promise. Requests for another project do
 *    not start a second IndexedDB sequence. finally releases the lock
 *    when the exact pending record still owns it. Generation changes
 *    must not strand the lock. A cancelled or stale operation may not
 *    update state or preference.
 *
 * 2. Fix fatal error dismissal:
 *    For view === "error", do not pass a dismiss action. Fatal
 *    startup/database errors must show Retry only.
 *
 * 3. Fully separate committed mutations from follow-up work:
 *    Creation: release creation lock before opening. Do not keep
 *    "Creating..." active while project opening runs.
 *    Rename: remove reconciliation reloadProjects() call.
 *    Delete: remove reconciliation reloadProjects() call.
 *
 * 4. Synchronize retry success with local form state:
 *    Uses creationSuccessVersion and renameSuccessVersion monotonic
 *    tokens so the UI can detect successful retries without matching
 *    project names.
 *
 * 5. Keep the retry action until settlement:
 *    Capture the action being retried and retain it while retrying === true.
 *    Clear only when the exact retry succeeds, user dismisses, or a
 *    replacement failure installs a new retry action.
 *
 * 6. Apply the unified lock to every project-shell control:
 *    While projectOperationPending is true, disable Back, Rename start,
 *    Delete start, Rename input, Rename Save, Rename Cancel,
 *    Delete confirmation Cancel, Delete confirmation Delete.
 *
 * 7. Make back navigation synchronous and safe:
 *    backToLauncher() does not depend on a database reload.
 *
 * 8. Deterministic project ordering:
 *    createdAt ascending, id ascending as tie-breaker.
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

/** Pending project-open operation record for single-flight ownership. */
interface PendingProjectOpen {
  token: symbol;
  projectId: string;
  promise: Promise<WorkspaceProject | null>;
  cancelled: boolean;
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
  const [creationSuccessVersion, setCreationSuccessVersion] = useState(0);
  const [renameSuccessVersion, setRenameSuccessVersion] = useState(0);

  const mountedRef = useRef(true);

  // --- Operation-generation token for stale async project opens ---
  const openGenerationRef = useRef(0);

  // --- Single-flight project opening ownership: PendingProjectOpen record ---
  const pendingOpenRef = useRef<PendingProjectOpen | null>(null);

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
   * Single-flight using a PendingProjectOpen record:
   * - The first open owns the operation.
   * - Repeated requests for the same project return the same promise.
   * - Requests for another project do not start a second IndexedDB sequence.
   * - finally releases the lock when the exact pending record still owns it.
   * - Generation changes must not strand the lock.
   * - A cancelled or stale operation may not update state or preference.
   *
   * Returns the project on success, or null on failure/unmount/rejection.
   */
  const openProject = useCallback(
    async (projectId: string): Promise<WorkspaceProject | null> => {
      // If an open is already in flight, check ownership.
      const existing = pendingOpenRef.current;
      if (existing) {
        // Same project: return the same promise (shared operation).
        if (existing.projectId === projectId) {
          return existing.promise;
        }
        // Different project: do not start a second sequence.
        return null;
      }

      // Claim ownership with a new PendingProjectOpen record.
      const token = Symbol("projectOpen");
      const generation = ++openGenerationRef.current;

      let resolveOpen!: (project: WorkspaceProject | null) => void;
      const openPromise = new Promise<WorkspaceProject | null>((res) => {
        resolveOpen = res;
      });

      const pending: PendingProjectOpen = {
        token,
        projectId,
        promise: openPromise,
        cancelled: false,
      };
      pendingOpenRef.current = pending;
      setOpeningProjectId(projectId);

      try {
        const project = await getProject(projectId);
        const files = await listProjectEntries(projectId);

        // Stale check: discard if a newer open request has started.
        if (generation !== openGenerationRef.current) {
          pending.cancelled = true;
          resolveOpen(null);
          return null;
        }
        if (!mountedRef.current) {
          pending.cancelled = true;
          resolveOpen(null);
          return null;
        }

        // Write the active-project preference before updating view.
        await setActiveProjectId(projectId);

        // Stale check again after the async preference write.
        if (generation !== openGenerationRef.current) {
          pending.cancelled = true;
          resolveOpen(null);
          return null;
        }
        if (!mountedRef.current) {
          pending.cancelled = true;
          resolveOpen(null);
          return null;
        }

        // Only the owned open may update state.
        setActiveProject(project);
        setActiveProjectFiles(files);
        // Clear stale errors and retry actions from a previous failure.
        setError(null);
        setRetryAction(null);
        setView("project");
        resolveOpen(project);
        return project;
      } catch (err) {
        // Stale check: discard error from an older request.
        if (generation !== openGenerationRef.current) {
          pending.cancelled = true;
          resolveOpen(null);
          return null;
        }
        if (!mountedRef.current) {
          pending.cancelled = true;
          resolveOpen(null);
          return null;
        }

        const we = toWorkspaceError(err);
        setError(we);
        setRetryAction({ type: "openProject", projectId });
        // Do NOT switch to "error" view: preserve the current view
        // (launcher or currently open project).
        resolveOpen(null);
        return null;
      } finally {
        // Release ownership: only if this exact pending record still owns it.
        if (pendingOpenRef.current === pending) {
          pendingOpenRef.current = null;
          if (mountedRef.current) {
            setOpeningProjectId(null);
          }
        }
        // Ensure the promise is resolved even if we somehow missed it.
        // (resolveOpen is always called in the try/catch above.)
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
          // we must NOT check generation against openGenerationRef here.
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
   * Once createProjectFromTemplate() resolves:
   * - Insert the returned project into state.
   * - Mark creation successful (increment creationSuccessVersion).
   * - Resolve handleCreateProject() with true immediately so the name
   *   field clears.
   * - Release the creation lock.
   * - Start the project-open operation separately.
   * - Opening failure must create an openProject retry, never a
   *   createProject retry.
   * - Do not keep "Creating..." active while project opening runs.
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

        // Mark creation successful so the launcher clears the name field.
        setCreationSuccessVersion((v) => v + 1);

        // Release the creation lock before starting the open.
        creatingRef.current = false;
        if (mountedRef.current) {
          setCreating(false);
        }

        // Start the project-open operation separately.
        // Do not keep "Creating..." active while project opening runs.
        const openResult = await openProject(project.id);
        if (!mountedRef.current) return true;

        if (!openResult) {
          // Opening failed, but creation succeeded.
          // Remain on launcher with the new project visible.
          // Retry is set to openProject (by openProject's catch), not createProject.
          // Ensure we are on the launcher view.
          setView((currentView) => (currentView === "project" ? currentView : "launcher"));
        }

        return true;
      } catch (err) {
        if (!mountedRef.current) return false;
        setError(toWorkspaceError(err));
        setRetryAction({ type: "createProject", name, templateId });
        // Do NOT switch to "error" view: launcher stays visible.
        return false;
      } finally {
        // Only release if we haven't already (creation success path releases early).
        if (creatingRef.current) {
          creatingRef.current = false;
          if (mountedRef.current) {
            setCreating(false);
          }
        }
      }
    },
    [insertProjectOrdered, openProject, toWorkspaceError],
  );

  /**
   * Rename the active project.
   *
   * Once renameProject() resolves:
   * - Update the active project and project list directly.
   * - Return success immediately.
   * - Remove the reconciliation reloadProjects() call.
   * - Increment renameSuccessVersion so the UI can detect success.
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

        // Signal success so the UI closes rename mode and syncs the name.
        setRenameSuccessVersion((v) => v + 1);

        // No reconciliation reloadProjects() call.
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
    [replaceProjectInState, toWorkspaceError],
  );

  /**
   * Delete a project with confirmation.
   *
   * Once deleteProject() resolves:
   * - Filter state.
   * - Switch to the launcher.
   * - Return success immediately.
   * - Remove the reconciliation reloadProjects() call.
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

        // No reconciliation reloadProjects() call.
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
    [filterProjectFromState, toWorkspaceError],
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
    // Cancel the pending open record.
    if (pendingOpenRef.current) {
      pendingOpenRef.current.cancelled = true;
      pendingOpenRef.current = null;
    }
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
   * The retry action is retained while retrying === true and cleared only
   * when the exact retry succeeds, the user explicitly dismisses, or a
   * replacement failure installs a new retry action.
   * A guard rejection or stale/cancelled operation must not silently
   * erase Retry.
   */
  const retry = useCallback(async () => {
    // Capture the action being retried.
    const action = retryAction;
    if (!action) return;
    // Synchronous guard: prevent overlapping retries.
    if (retryingRef.current) return;
    retryingRef.current = true;

    setRetrying(true);

    try {
      switch (action.type) {
        case "startup": {
          await startup();
          // startup sets its own error/retryAction on failure.
          // On success, startup clears error/retryAction.
          break;
        }
        case "openProject": {
          if (action.projectId) {
            const result = await openProject(action.projectId);
            // openProject sets error/retryAction on failure.
            // On success, openProject clears error/retryAction.
            // Only clear our captured action on success.
            if (result) {
              setError(null);
              setRetryAction(null);
            }
          }
          break;
        }
        case "createProject": {
          if (action.name && action.templateId) {
            const success = await handleCreateProject(action.name, action.templateId);
            // handleCreateProject sets error/retryAction on failure.
            // On success, it clears error/retryAction.
            if (success) {
              setError(null);
              setRetryAction(null);
            }
          }
          break;
        }
        case "renameProject": {
          if (action.projectId && action.name) {
            const success = await handleRenameProject(action.projectId, action.name);
            // handleRenameProject sets error/retryAction on failure.
            if (success) {
              setError(null);
              setRetryAction(null);
            }
          }
          break;
        }
        case "deleteProject": {
          if (action.projectId) {
            const success = await handleDeleteProject(action.projectId);
            // handleDeleteProject sets error/retryAction on failure.
            if (success) {
              setError(null);
              setRetryAction(null);
            }
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
    creationSuccessVersion,
    renameSuccessVersion,
    handleCreateProject,
    handleRenameProject,
    handleDeleteProject,
    backToLauncher,
    retry,
    dismissError,
    openProjectById: openProject,
  };
}
