"use client";

/**
 * Workspace shell for CoderXP M2 Workspace Alpha.
 *
 * Correction (fix(workspace): preserve retry and open ownership):
 * - Passes retrying to ProjectLauncher so all launcher controls are
 *   disabled while a retry is settling.
 * - Fatal error view (view === "error") shows Retry only, no Dismiss.
 * - Launcher and project views show ErrorBanner with retrying state.
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
    creationSuccessVersion,
    renameSuccessVersion,
    handleCreateProject,
    handleRenameProject,
    handleDeleteProject,
    backToLauncher,
    retry,
    dismissError,
    openProjectById,
  } = useWorkspaceState();

  const projectOperationPending =
    renaming || deleting || retrying || openingProjectId !== null;

  return (
    <div className="min-h-[calc(100vh-3.5rem)] bg-[#0d0e10] text-gray-200">
      {view === "loading" && (
        <div className="flex items-center justify-center min-h-[60vh]">
          <p className="text-sm text-gray-500">Loading workspace...</p>
        </div>
      )}

      {view === "error" && error && (
        <div className="flex items-center justify-center min-h-[60vh]">
          <ErrorBanner
            error={error}
            onRetry={retry}
            retrying={retrying}
          />
        </div>
      )}

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
            retrying={retrying}
            creationSuccessVersion={creationSuccessVersion}
            onCreate={handleCreateProject}
            onOpen={openProjectById}
          />
        </div>
      )}

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
            renameSuccessVersion={renameSuccessVersion}
            onBack={backToLauncher}
            onRename={(newName) => handleRenameProject(activeProject.id, newName)}
            onDelete={() => handleDeleteProject(activeProject.id)}
          />
        </div>
      )}
    </div>
  );
}
