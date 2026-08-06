"use client";

/**
 * Workspace shell for CoderXP M2 Workspace Alpha.
 *
 * Final correction scope: orchestrates the project lifecycle experience.
 *
 * - ErrorBanner is not reserved only for view === "error".
 * - Shows Retry only when a retry action exists.
 * - Passes retrying to ErrorBanner.
 * - Passes openingProjectId to ProjectLauncher.
 * - Passes projectOperationPending to ProjectShell.
 *
 * On mount, the hook checks persistence availability, loads the project
 * list, reads the active project preference, and opens the active project
 * or shows the launcher. All states are truthful: loading, launcher,
 * open project, or typed error.
 *
 * Visual style: obsidian/graphite background, warm-white text, subtle
 * cyan accents, Lucide icons. No emoji, no purple/magenta, no fake terminal.
 */

import { useWorkspaceState } from "./hooks/useWorkspaceState";
import { ProjectLauncher } from "./components/ProjectLauncher";
import { ProjectShell } from "./components/ProjectShell";
import { ErrorBanner } from "./components/ErrorBanner";

export default function WorkspaceShell() {
  const {
    view,
    projects,
    activeProject,
    activeProjectFiles,
    error,
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
    openProjectById,
  } = useWorkspaceState();

  // Unified cross-operation lock: rename, delete, retry, and opening
  // must never overlap with each other.
  const projectOperationPending =
    renaming || deleting || retrying || openingProjectId !== null;

  return (
    <div className="min-h-[calc(100vh-3.5rem)] bg-[#0d0e10] text-gray-200">
      {view === "loading" && (
        <div className="flex items-center justify-center min-h-[60vh]">
          <p className="text-sm text-gray-500">Loading workspace...</p>
        </div>
      )}

      {/* Fatal startup/database error: full-screen error view */}
      {view === "error" && error && (
        <div className="flex items-center justify-center min-h-[60vh]">
          <ErrorBanner
            error={error}
            onRetry={retry}
            retrying={retrying}
            onDismiss={dismissError}
          />
        </div>
      )}

      {/* Launcher + visible operation error */}
      {view === "launcher" && (
        <div>
          {error && retryAction && (
            <ErrorBanner
              error={error}
              onRetry={retry}
              retrying={retrying}
              onDismiss={dismissError}
            />
          )}
          <ProjectLauncher
            projects={projects}
            creating={creating}
            openingProjectId={openingProjectId}
            onCreate={handleCreateProject}
            onOpen={openProjectById}
          />
        </div>
      )}

      {/* Project shell + visible operation error */}
      {view === "project" && activeProject && (
        <div className="flex flex-col h-[calc(100vh-3.5rem)]">
          {error && retryAction && (
            <ErrorBanner
              error={error}
              onRetry={retry}
              retrying={retrying}
              onDismiss={dismissError}
            />
          )}
          <ProjectShell
            project={activeProject}
            files={activeProjectFiles}
            renaming={renaming}
            deleting={deleting}
            projectOperationPending={projectOperationPending}
            onBack={backToLauncher}
            onRename={(newName) => handleRenameProject(activeProject.id, newName)}
            onDelete={() => handleDeleteProject(activeProject.id)}
          />
        </div>
      )}
    </div>
  );
}
