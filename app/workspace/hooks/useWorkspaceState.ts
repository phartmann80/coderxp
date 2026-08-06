"use client";

/**
 * Workspace state hook for CoderXP M2 Workspace Alpha.
 *
 * Commit 3 scope: startup lifecycle, project list, active project
 * selection, persistence availability check, and typed error handling.
 *
 * On client mount:
 * 1. Check persistence availability.
 * 2. Load the project list.
 * 3. Read activeProjectId.
 * 4. Open that project when it still exists.
 * 5. Clear or ignore a stale active-project preference.
 * 6. Otherwise show the project launcher.
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
import type { PersistenceErrorCode, WorkspaceProject, WorkspaceFileRecord } from "@/lib/workspace/types";

/** UI view states. */
export type WorkspaceView = "loading" | "launcher" | "project" | "error";

/** Typed workspace error for UI display. */
export interface WorkspaceError {
  code: PersistenceErrorCode;
  message: string;
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

  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  /** Map a PersistenceError or unknown error to a WorkspaceError. */
  const toWorkspaceError = useCallback((err: unknown): WorkspaceError => {
    if (err && typeof err === "object" && "code" in err && "message" in err) {
      return {
        code: (err as { code: PersistenceErrorCode }).code,
        message: (err as { message: string }).message,
      };
    }
    return {
      code: "TRANSACTION_FAILED",
      message: "An unexpected error occurred.",
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

  /** Open a project by ID: loads project record and its file entries. */
  const openProject = useCallback(
    async (projectId: string): Promise<WorkspaceProject | null> => {
      try {
        const project = await getProject(projectId);
        const files = await listProjectEntries(projectId);
        if (!mountedRef.current) return null;
        setActiveProject(project);
        setActiveProjectFiles(files);
        setView("project");
        await setActiveProjectId(projectId);
        return project;
      } catch (err) {
        if (!mountedRef.current) return null;
        const we = toWorkspaceError(err);
        setError(we);
        setView("error");
        return null;
      }
    },
    [toWorkspaceError],
  );

  /** Initial startup: check persistence, load projects, open active project. */
  useEffect(() => {
    const startup = async () => {
      if (!isWorkspacePersistenceAvailable()) {
        if (mountedRef.current) {
          setPersistenceAvailable(false);
          setError({
            code: "PERSISTENCE_UNAVAILABLE",
            message: "Local storage is not available in this browser.",
          });
          setView("error");
        }
        return;
      }

      try {
        const list = await reloadProjects();
        if (!mountedRef.current) return;

        const activeId = await getActiveProjectId();
        if (!mountedRef.current) return;

        if (activeId) {
          // Check if the active project still exists.
          const found = list.find((p) => p.id === activeId);
          if (found) {
            await openProject(activeId);
          } else {
            // Stale active-project preference: ignore it, show launcher.
            // Do not write to clear it — just don't open a non-existent project.
            setView("launcher");
          }
        } else {
          setView("launcher");
        }
      } catch (err) {
        if (!mountedRef.current) return;
        const we = toWorkspaceError(err);
        setError(we);
        setView("error");
      }
    };

    startup();
  }, [reloadProjects, openProject, toWorkspaceError]);

  /** Create a new project from a template. */
  const handleCreateProject = useCallback(
    async (name: string, templateId: "static-html" | "react-ts" | "nextjs-ts") => {
      setCreating(true);
      setError(null);
      try {
        const project = await createProjectFromTemplate(name, templateId);
        if (!mountedRef.current) return;
        await reloadProjects();
        await openProject(project.id);
      } catch (err) {
        if (!mountedRef.current) return;
        setError(toWorkspaceError(err));
      } finally {
        if (mountedRef.current) {
          setCreating(false);
        }
      }
    },
    [reloadProjects, openProject, toWorkspaceError],
  );

  /** Rename the active project. */
  const handleRenameProject = useCallback(
    async (projectId: string, newName: string) => {
      setRenaming(true);
      setError(null);
      try {
        const updated = await renameProject(projectId, newName);
        if (!mountedRef.current) return;
        setActiveProject(updated);
        await reloadProjects();
      } catch (err) {
        if (!mountedRef.current) return;
        setError(toWorkspaceError(err));
      } finally {
        if (mountedRef.current) {
          setRenaming(false);
        }
      }
    },
    [reloadProjects, toWorkspaceError],
  );

  /** Delete a project with confirmation. */
  const handleDeleteProject = useCallback(
    async (projectId: string) => {
      setDeleting(true);
      setError(null);
      try {
        await deleteProject(projectId);
        if (!mountedRef.current) return;
        setActiveProject(null);
        setActiveProjectFiles([]);
        await reloadProjects();
        setView("launcher");
      } catch (err) {
        if (!mountedRef.current) return;
        setError(toWorkspaceError(err));
      } finally {
        if (mountedRef.current) {
          setDeleting(false);
        }
      }
    },
    [reloadProjects, toWorkspaceError],
  );

  /** Go back to the launcher view. */
  const backToLauncher = useCallback(async () => {
    setActiveProject(null);
    setActiveProjectFiles([]);
    await reloadProjects();
    if (mountedRef.current) {
      setView("launcher");
    }
  }, [reloadProjects]);

  /** Retry the last failed operation (re-run startup). */
  const retry = useCallback(() => {
    setError(null);
    setView("loading");
    // Re-trigger startup by reloading projects and checking state.
    const retryStartup = async () => {
      if (!isWorkspacePersistenceAvailable()) {
        if (mountedRef.current) {
          setPersistenceAvailable(false);
          setError({
            code: "PERSISTENCE_UNAVAILABLE",
            message: "Local storage is not available in this browser.",
          });
          setView("error");
        }
        return;
      }
      try {
        const list = await reloadProjects();
        if (!mountedRef.current) return;
        const activeId = await getActiveProjectId();
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
        if (!mountedRef.current) return;
        setError(toWorkspaceError(err));
        setView("error");
      }
    };
    retryStartup();
  }, [reloadProjects, openProject, toWorkspaceError]);

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
    handleCreateProject,
    handleRenameProject,
    handleDeleteProject,
    backToLauncher,
    retry,
    openProjectById: openProject,
  };
}