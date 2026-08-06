"use client";

/**
 * Workspace shell for CoderXP M2 Workspace Alpha.
 *
 * Commit 3 correction scope: orchestrates the project lifecycle experience.
 *
 * Correction 2: ErrorBanner is not reserved only for view === "error".
 * The shell supports:
 * - launcher + visible operation error
 * - project shell + visible operation error
 * - fatal startup/database error view
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
    retryAction,
    handleCreateProject,
    handleRenameProject,
    handleDeleteProject,
    backToLauncher,
    retry,
    dismissError,
    openProjectById,
  } = useWorkspaceState();

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
          <ErrorBanner error={error} onRetry={retry} />
        </div>
      )}

      {/* Launcher + visible operation error (correction 2) */}
      {view === "launcher" && (
        <div>
          {error && (
            <ErrorBanner error={error} onRetry={retry} onDismiss={dismissError} />
          )}
          <ProjectLauncher
            projects={projects}
            creating={creating}
            onCreate={handleCreateProject}
            onOpen={openProjectById}
          />
        </div>
      )}

      {/* Project shell + visible operation error (correction 2) */}
      {view === "project" && activeProject && (
        <div className="flex flex-col h-[calc(100vh-3.5rem)]">
          {error && (
            <ErrorBanner error={error} onRetry={retry} onDismiss={dismissError} />
          )}
          <ProjectShell
            project={activeProject}
            files={activeProjectFiles}
            renaming={renaming}
            deleting={deleting}
            onBack={backToLauncher}
            onRename={(newName) => handleRenameProject(activeProject.id, newName)}
            onDelete={() => handleDeleteProject(activeProject.id)}
          />
        </div>
      )}
    </div>
  );
}
