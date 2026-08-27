"use client";

/**
 * Workspace shell for CoderXP M2/M3 Workspace v2.
 *
 * Provides full 100vh viewport without marketing header/footer offsets.
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
    handleProjectUpdate,
    backToLauncher,
    retry,
    dismissError,
    openProjectById,
    refreshActiveProjectFiles,
    fileOperationVersion,
  } = useWorkspaceState();

  const projectOperationPending =
    renaming || deleting || retrying || openingProjectId !== null;

  return (
    <div className="h-screen w-screen overflow-hidden bg-[#151617] text-gray-200">
      {view === "loading" && (
        <div className="flex items-center justify-center h-full">
          <p className="text-sm text-gray-500">Loading workspace...</p>
        </div>
      )}

      {view === "error" && error && (
        <div className="flex items-center justify-center h-full">
          <ErrorBanner
            error={error}
            onRetry={retry}
            retrying={retrying}
          />
        </div>
      )}

      {view === "launcher" && (
        <div className="h-full overflow-y-auto">
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
        <div className="flex flex-col h-full overflow-hidden">
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
            fileOperationVersion={fileOperationVersion}
            onBack={backToLauncher}
            onRename={(newName) => handleRenameProject(activeProject.id, newName)}
            onDelete={() => handleDeleteProject(activeProject.id)}
            onProjectUpdate={handleProjectUpdate}
            onRefreshFiles={() => refreshActiveProjectFiles(activeProject.id)}
          />
        </div>
      )}
    </div>
  );
}
