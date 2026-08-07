"use client";

/**
 * Workspace state hook for CoderXP M2 Workspace Alpha.
 *
 * Correction (fix(workspace): preserve retry and open ownership):
 *
 * 1. Do not clear retry state inside retried handlers:
 *    Split create/rename/delete into execute* functions that do NOT
 *    clear error/retryAction. The captured Retry action remains
 *    installed while retrying === true.
 *
 * 2. Return structured operation outcomes:
 *    CreateProjectResult distinguishes creation success from opening
 *    success. Creation resolves immediately; opening starts separately.
 *
 * 3. Make retry clearing compare-and-set:
 *    RetryAction has an id. retry() only clears the captured action
 *    if the current retryAction is still the same one.
 *
 * 4. Clear startup errors on real startup success:
 *    startup() clears error/retryAction when it succeeds.
 *
 * 5. Keep pending-open ownership until actual settlement:
 *    backToLauncher marks cancelled but does not null pendingOpenRef
 *    while the DB sequence is still running.
 *
 * 6. One hook-level workspace-operation guard:
 *    workspaceOperationRef synchronously rejects overlapping operations.
 *
 * 7. Launcher honors retrying:
 *    retrying is passed to ProjectLauncher to disable all controls.
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

export type WorkspaceView = "loading" | "launcher" | "project" | "error";

export interface WorkspaceError {
  code: PersistenceErrorCode;
  message: string;
}

export type RetryActionType =
  | "startup"
  | "openProject"
  | "createProject"
  | "renameProject"
  | "deleteProject";

export interface RetryAction {
  id: number;
  type: RetryActionType;
  projectId?: string;
  name?: string;
  templateId?: ProjectTemplateId;
}

/** Structured create result: creation and opening are separate outcomes. */
export type CreateProjectResult =
  | { created: false }
  | { created: true; project: WorkspaceProject; openStarted: boolean };

interface PendingProjectOpen {
  token: symbol;
  projectId: string;
  promise: Promise<WorkspaceProject | null>;
  cancelled: boolean;
}

/** Hook-level workspace operation guard. */
type WorkspaceOperation =
  | { kind: "idle" }
  | { kind: "create" }
  | { kind: "open"; projectId: string }
  | { kind: "rename" }
  | { kind: "delete" }
  | { kind: "retry" };

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

const GENERIC_ERROR_MESSAGE = "An unexpected local operation failed. Please try again.";

let retryActionIdCounter = 0;
function nextRetryActionId(): number {
  return ++retryActionIdCounter;
}

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
  const openGenerationRef = useRef(0);
  const pendingOpenRef = useRef<PendingProjectOpen | null>(null);
  const retryingRef = useRef(false);
  const creatingRef = useRef(false);
  const renamingRef = useRef(false);
  const deletingRef = useRef(false);

  // Hook-level workspace-operation guard: one synchronous owner record.
  const workspaceOpRef = useRef<WorkspaceOperation>({ kind: "idle" });
  const openProjectRef = useRef<(projectId: string) => Promise<WorkspaceProject | null>>(async () => null);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  /**
   * Try to claim a workspace operation. Returns true if claimed.
   * An operation may own its nested child explicitly (create -> open).
   */
  const tryClaimOperation = useCallback(
    (op: Exclude<WorkspaceOperation, { kind: "idle" }>): boolean => {
      if (workspaceOpRef.current.kind !== "idle") return false;
      workspaceOpRef.current = op;
      return true;
    },
    [],
  );

  /** Release the workspace operation if the current owner matches. */
  const releaseOperation = useCallback(
    (op: Exclude<WorkspaceOperation, { kind: "idle" }>): void => {
      if (workspaceOpRef.current.kind === op.kind) {
        workspaceOpRef.current = { kind: "idle" };
      }
    },
    [],
  );

  /** Transfer ownership from one operation to a nested child. */
  const transferOperation = useCallback(
    (
      from: Exclude<WorkspaceOperation, { kind: "idle" }>,
      to: Exclude<WorkspaceOperation, { kind: "idle" }>,
    ): void => {
      if (workspaceOpRef.current.kind === from.kind) {
        workspaceOpRef.current = to;
      }
    },
    [],
  );

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

  const reloadProjects = useCallback(async (): Promise<WorkspaceProject[]> => {
    const list = await listProjects();
    if (mountedRef.current) {
      setProjects(list);
    }
    return list;
  }, []);

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

  const replaceProjectInState = useCallback((updated: WorkspaceProject) => {
    setProjects((prev) =>
      prev.map((p) => (p.id === updated.id ? updated : p)),
    );
  }, []);

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
   * - pending.cancelled is checked before every state update and preference write.
   * - Ownership remains until the underlying open sequence actually finishes.
   */
  const openProject = useCallback(
    async (projectId: string): Promise<WorkspaceProject | null> => {
      const existing = pendingOpenRef.current;
      if (existing) {
        if (existing.projectId === projectId) {
          return existing.promise;
        }
        // Different project: do not start a second sequence.
        // Serialize behind the existing promise.
        return existing.promise.then(() => { if (pendingOpenRef.current === null) return openProjectRef.current(projectId); return null; });
      }

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

        // Check cancelled before every state update.
        if (pending.cancelled || generation !== openGenerationRef.current) {
          resolveOpen(null);
          return null;
        }
        if (!mountedRef.current) {
          resolveOpen(null);
          return null;
        }

        const files = await listProjectEntries(projectId);

        if (pending.cancelled || generation !== openGenerationRef.current) {
          resolveOpen(null);
          return null;
        }
        if (!mountedRef.current) {
          resolveOpen(null);
          return null;
        }

        // Write the active-project preference.
        await setActiveProjectId(projectId);

        // Check cancelled after the async preference write.
        if (pending.cancelled || generation !== openGenerationRef.current) {
          resolveOpen(null);
          return null;
        }
        if (!mountedRef.current) {
          resolveOpen(null);
          return null;
        }

        // Only the owned, non-cancelled open may update state.
        setActiveProject(project);
        setActiveProjectFiles(files);
        setError(null);
        setRetryAction(null);
        setView("project");
        resolveOpen(project);
        return project;
      } catch (err) {
        if (pending.cancelled || generation !== openGenerationRef.current) {
          resolveOpen(null);
          return null;
        }
        if (!mountedRef.current) {
          resolveOpen(null);
          return null;
        }

        const we = toWorkspaceError(err);
        setError(we);
        setRetryAction({ id: nextRetryActionId(), type: "openProject", projectId });
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
        // Release the workspace operation guard if owned by this open.
        releaseOperation({ kind: "open", projectId });
      }
    },
    [toWorkspaceError, releaseOperation],
  );

  // Keep the ref in sync so serialized opens can call the latest version.
  useEffect(() => {
    openProjectRef.current = openProject;
  }, [openProject]);

  /**
   * Startup: check persistence, load projects, open active project.
   *
   * On success (with or without active project), clears prior errors.
   * On failure, sets error and retryAction.
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
      setRetryAction({ id: nextRetryActionId(), type: "startup" });
      setView("error");
      return;
    }

    try {
      const list = await reloadProjects();
      if (generation !== openGenerationRef.current) return;
      if (!mountedRef.current) return;

      setPersistenceAvailable(true);

      const activeId = await getActiveProjectId();
      if (generation !== openGenerationRef.current) return;
      if (!mountedRef.current) return;

      if (activeId) {
        const found = list.find((p) => p.id === activeId);
        if (found) {
          const result = await openProject(activeId);
          if (!mountedRef.current) return;
          if (!result) {
            // Open failed: show launcher with error + retry.
            // Clear any stale startup error first.
            setView("launcher");
          } else {
            // Startup succeeded with active project: clear errors.
            setError(null);
            setRetryAction(null);
          }
          return;
        }
      }
      // No active project or not found: clean launcher.
      setError(null);
      setRetryAction(null);
      setView("launcher");
    } catch (err) {
      if (generation !== openGenerationRef.current) return;
      if (!mountedRef.current) return;
      const we = toWorkspaceError(err);
      setError(we);
      setRetryAction({ id: nextRetryActionId(), type: "startup" });
      setView("error");
    }
  }, [reloadProjects, openProject, toWorkspaceError]);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      if (!cancelled) await startup();
    };
    run();
    return () => { cancelled = true; };
  }, [startup]);

  /**
   * Execute creation WITHOUT clearing error/retryAction.
   * This is the internal function called both by handleCreateProject
   * and by retry().
   *
   * Returns a structured CreateProjectResult so callers can distinguish
   * creation success from opening success.
   */
  const executeCreate = useCallback(
    async (name: string, templateId: ProjectTemplateId): Promise<CreateProjectResult> => {
      if (creatingRef.current) return { created: false };
      if (!tryClaimOperation({ kind: "create" })) return { created: false };
      creatingRef.current = true;

      setCreating(true);

      try {
        const project = await createProjectFromTemplate(name, templateId);
        if (!mountedRef.current) {
          releaseOperation({ kind: "create" });
          return { created: true, project, openStarted: false };
        }

        // Creation committed: insert into state, signal success.
        insertProjectOrdered(project);
        setCreationSuccessVersion((v) => v + 1);

        // Release creation lock and operation guard.
        creatingRef.current = false;
        if (mountedRef.current) {
          setCreating(false);
        }
        releaseOperation({ kind: "create" });

        // Start project opening independently (transfer ownership to open).
        tryClaimOperation({ kind: "open", projectId: project.id });
        // Fire-and-forget: do NOT await opening as part of creation success.
        openProject(project.id).then(() => {
          // openProject handles its own error/retryAction on failure.
        });

        return { created: true, project, openStarted: true };
      } catch (err) {
        if (!mountedRef.current) {
          releaseOperation({ kind: "create" });
          return { created: false };
        }
        setError(toWorkspaceError(err));
        setRetryAction({ id: nextRetryActionId(), type: "createProject", name, templateId });
        return { created: false };
      } finally {
        if (creatingRef.current) {
          creatingRef.current = false;
          if (mountedRef.current) {
            setCreating(false);
          }
        }
      }
    },
    [insertProjectOrdered, openProject, toWorkspaceError, tryClaimOperation, releaseOperation],
  );

  /**
   * Public create handler. Clears error/retryAction at entry
   * (NOT when called via retry).
   */
  const handleCreateProject = useCallback(
    async (name: string, templateId: ProjectTemplateId): Promise<boolean> => {
      setError(null);
      setRetryAction(null);
      const result = await executeCreate(name, templateId);
      return result.created;
    },
    [executeCreate],
  );

  /**
   * Execute rename WITHOUT clearing error/retryAction.
   */
  const executeRename = useCallback(
    async (projectId: string, newName: string): Promise<boolean> => {
      if (renamingRef.current) return false;
      if (!tryClaimOperation({ kind: "rename" })) return false;
      renamingRef.current = true;

      setRenaming(true);

      try {
        const updated = await renameProject(projectId, newName);
        if (!mountedRef.current) {
          releaseOperation({ kind: "rename" });
          return true;
        }

        setActiveProject(updated);
        replaceProjectInState(updated);
        setRenameSuccessVersion((v) => v + 1);

        return true;
      } catch (err) {
        if (!mountedRef.current) {
          releaseOperation({ kind: "rename" });
          return false;
        }
        setError(toWorkspaceError(err));
        setRetryAction({ id: nextRetryActionId(), type: "renameProject", projectId, name: newName });
        return false;
      } finally {
        renamingRef.current = false;
        if (mountedRef.current) {
          setRenaming(false);
        }
        releaseOperation({ kind: "rename" });
      }
    },
    [replaceProjectInState, toWorkspaceError, tryClaimOperation, releaseOperation],
  );

  const handleRenameProject = useCallback(
    async (projectId: string, newName: string): Promise<boolean> => {
      setError(null);
      setRetryAction(null);
      return executeRename(projectId, newName);
    },
    [executeRename],
  );

  /**
   * Execute delete WITHOUT clearing error/retryAction.
   */
  const executeDelete = useCallback(
    async (projectId: string): Promise<boolean> => {
      if (deletingRef.current) return false;
      if (!tryClaimOperation({ kind: "delete" })) return false;
      deletingRef.current = true;

      setDeleting(true);

      try {
        await deleteProject(projectId);
        if (!mountedRef.current) {
          releaseOperation({ kind: "delete" });
          return true;
        }

        filterProjectFromState(projectId);
        setActiveProject(null);
        setActiveProjectFiles([]);
        setError(null);
        setRetryAction(null);
        setView("launcher");

        return true;
      } catch (err) {
        if (!mountedRef.current) {
          releaseOperation({ kind: "delete" });
          return false;
        }
        setError(toWorkspaceError(err));
        setRetryAction({ id: nextRetryActionId(), type: "deleteProject", projectId });
        return false;
      } finally {
        deletingRef.current = false;
        if (mountedRef.current) {
          setDeleting(false);
        }
        releaseOperation({ kind: "delete" });
      }
    },
    [filterProjectFromState, toWorkspaceError, tryClaimOperation, releaseOperation],
  );

  const handleDeleteProject = useCallback(
    async (projectId: string): Promise<boolean> => {
      setError(null);
      setRetryAction(null);
      return executeDelete(projectId);
    },
    [executeDelete],
  );

  /**
   * Go back to the launcher view.
   *
   * Marks the pending open as cancelled but does NOT null pendingOpenRef
   * while its database sequence is still running. The finally block in
   * openProject will clear it when the sequence settles.
   */
  const backToLauncher = useCallback(() => {
    openGenerationRef.current++;
    if (pendingOpenRef.current) {
      pendingOpenRef.current.cancelled = true;
      // Do NOT set pendingOpenRef.current = null here.
      // The finally block in openProject will clear it when the DB
      // sequence actually settles. This prevents a new open from
      // starting in parallel with the old one.
    }
    // Only clear openingProjectId if there is no pending open still running.
    // The finally block in openProject will clear it.
    if (!pendingOpenRef.current) {
      setOpeningProjectId(null);
    }
    setActiveProject(null);
    setActiveProjectFiles([]);
    setError(null);
    setRetryAction(null);
    setView("launcher");
  }, []);

  /**
   * Retry the actual failed operation.
   *
   * Uses compare-and-set: only clears the captured action if the
   * current retryAction is still the same one (by id).
   * The error banner remains rendered with Retry disabled while retrying.
   */
  const retry = useCallback(async () => {
    const action = retryAction;
    if (!action) return;
    if (retryingRef.current) return;
    if (!tryClaimOperation({ kind: "retry" })) return;
    retryingRef.current = true;

    setRetrying(true);

    try {
      switch (action.type) {
        case "startup": {
          await startup();
          // startup sets its own error/retryAction on failure.
          // On success, startup clears error/retryAction.
          // Compare-and-set: only clear if still our action.
          if (mountedRef.current && retryAction?.id === action.id) {
            setError(null);
            setRetryAction(null);
          }
          break;
        }
        case "openProject": {
          if (action.projectId) {
            const result = await openProject(action.projectId);
            if (result && mountedRef.current && retryAction?.id === action.id) {
              setError(null);
              setRetryAction(null);
            }
          }
          break;
        }
        case "createProject": {
          if (action.name && action.templateId) {
            const result = await executeCreate(action.name, action.templateId);
            if (result.created && mountedRef.current && retryAction?.id === action.id) {
              // Creation succeeded. But openProject may have installed
              // a NEW retryAction (openProject failure). Only clear if
              // the current action is still ours.
              setError(null);
              setRetryAction(null);
            }
          }
          break;
        }
        case "renameProject": {
          if (action.projectId && action.name) {
            const success = await executeRename(action.projectId, action.name);
            if (success && mountedRef.current && retryAction?.id === action.id) {
              setError(null);
              setRetryAction(null);
            }
          }
          break;
        }
        case "deleteProject": {
          if (action.projectId) {
            const success = await executeDelete(action.projectId);
            if (success && mountedRef.current && retryAction?.id === action.id) {
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
      releaseOperation({ kind: "retry" });
    }
  }, [retryAction, startup, openProject, executeCreate, executeRename, executeDelete, tryClaimOperation, releaseOperation]);

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
