"use client";

/**
 * Open-project shell for CoderXP M2 Workspace Alpha.
 *
 * Final correction scope:
 * - Rename mode closes only after successful rename.
 * - Rename text remains available after failure.
 * - Delete confirmation closes only after successful deletion.
 * - Selected-file summary shows the actual stored kind (file/directory).
 * - Accepts projectOperationPending to disable Back, Rename, Delete, Cancel
 *   while any cross-operation is pending (rename, delete, retry, opening).
 * - Rename input and Cancel are disabled while the rename transaction is pending.
 * - Delete-confirmation Cancel is disabled while deletion is pending.
 * - Opening another project is disabled while any operation is pending.
 *
 * Does NOT include:
 * - CodeMirror or editable file contents
 * - Terminal, preview panel, run button, fake build status, or fake output
 */

import { useMemo, useState, useCallback } from "react";
import {
  ArrowLeft,
  HardDrive,
  Pencil,
  Trash2,
  X,
} from "lucide-react";
import type { WorkspaceProject, WorkspaceFileRecord } from "@/lib/workspace/types";
import { buildFileTree } from "@/lib/workspace/project-tree";
import { FileTree } from "./FileTree";
import { EditorPanel } from "./EditorPanel";

interface ProjectShellProps {
  project: WorkspaceProject;
  files: WorkspaceFileRecord[];
  renaming: boolean;
  deleting: boolean;
  projectOperationPending: boolean;
  renameSuccessVersion: number;
  onBack: () => void;
  onRename: (newName: string) => Promise<boolean>;
  onDelete: () => Promise<boolean>;
  onProjectUpdate: (updated: WorkspaceProject) => void;
}

export function ProjectShell({
  project,
  files,
  renaming,
  deleting,
  projectOperationPending,
  renameSuccessVersion,
  onBack,
  onRename,
  onDelete,
  onProjectUpdate,
}: ProjectShellProps) {
  const [selectedPath, setSelectedPath] = useState<string | null>(project.activeFile);
  const [fileToOpen, setFileToOpen] = useState<string | null>(null);
  const [renameMode, setRenameMode] = useState(false);
  const [renameValue, setRenameValue] = useState(project.name);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Close rename mode and sync the displayed name when rename succeeds
  // (including on retry). Uses the monotonic renameSuccessVersion token
  // so we detect success without matching project names.
  // Adjusting state during render is the React-recommended pattern for
  // syncing local state to a changing prop/external signal.
  const [lastSeenRenameVersion, setLastSeenRenameVersion] = useState(renameSuccessVersion);
  if (renameSuccessVersion !== lastSeenRenameVersion) {
    setLastSeenRenameVersion(renameSuccessVersion);
    setRenameMode(false);
    setRenameValue(project.name);
  }

  const tree = useMemo(() => buildFileTree(files), [files]);

  const handleRenameSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (renameValue.trim().length === 0 || renaming || projectOperationPending) return;

    // Rename mode is closed by the renameSuccessVersion effect after
    // successful rename. On failure, rename mode stays open and the
    // rename text is preserved.
    await onRename(renameValue);
  };

  const handleDeleteConfirm = async () => {
    if (projectOperationPending) return;
    // Close delete confirmation only after successful deletion.
    const success = await onDelete();
    if (success) {
      setConfirmDelete(false);
    }
    // On failure, the confirmation modal stays open with the project context.
  };

  const handleFileSelect = useCallback((path: string) => {
    setSelectedPath(path);
    // Only open files (not directories) in the editor.
    const record = files.find((f) => f.path === path);
    if (record && record.kind === "file") {
      setFileToOpen(path);
    }
  }, [files]);

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      {/* Project header bar */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-gray-800 bg-gray-900/50">
        <div className="flex items-center gap-3">
          <button
            onClick={onBack}
            disabled={projectOperationPending}
            className="flex items-center gap-1.5 text-sm text-gray-400 hover:text-gray-200 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <ArrowLeft className="w-4 h-4" />
            Projects
          </button>
          <span className="text-gray-700">/</span>
          {renameMode ? (
            <form onSubmit={handleRenameSubmit} className="flex items-center gap-2">
              <input
                type="text"
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                maxLength={100}
                autoFocus
                disabled={renaming || projectOperationPending}
                className="px-2 py-0.5 text-sm text-gray-100 bg-gray-800 border border-gray-600 rounded focus:outline-none focus:border-cyan-600 disabled:opacity-50"
              />
              <button
                type="submit"
                disabled={renaming || projectOperationPending || renameValue.trim().length === 0}
                className="text-xs text-cyan-500 hover:text-cyan-400 disabled:opacity-50"
              >
                {renaming ? "Saving..." : "Save"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setRenameMode(false);
                  setRenameValue(project.name);
                }}
                disabled={renaming || projectOperationPending}
                className="text-xs text-gray-500 hover:text-gray-400 disabled:opacity-50"
              >
                Cancel
              </button>
            </form>
          ) : (
            <span className="text-sm font-medium text-gray-100">{project.name}</span>
          )}
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 text-xs text-gray-500">
            <HardDrive className="w-3.5 h-3.5" />
            <span>Local storage</span>
          </div>
          <span className="text-xs text-gray-600">
            {project.templateId === "static-html" ? "Static HTML" : project.templateId}
          </span>
          {!renameMode && (
            <button
              onClick={() => {
                setRenameMode(true);
                setRenameValue(project.name);
              }}
              disabled={renaming || projectOperationPending}
              className="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-200 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Pencil className="w-3.5 h-3.5" />
              Rename
            </button>
          )}
          <button
            onClick={() => setConfirmDelete(true)}
            disabled={deleting || projectOperationPending}
            className="flex items-center gap-1 text-xs text-red-400 hover:text-red-300 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Trash2 className="w-3.5 h-3.5" />
            Delete
          </button>
        </div>
      </div>

      {/* Main content: file tree + file summary */}
      <div className="flex flex-1 overflow-hidden">
        {/* File tree sidebar */}
        <div className="w-64 border-r border-gray-800 bg-gray-900/30 overflow-y-auto p-2">
          <div className="text-xs text-gray-600 uppercase tracking-wide px-2 py-1.5 mb-1">
            Files
          </div>
          {tree.length === 0 ? (
            <p className="text-xs text-gray-600 italic px-2 py-1">No files in this project.</p>
          ) : (
            <FileTreeWrapper
              nodes={tree}
              selectedPath={selectedPath}
              onSelect={handleFileSelect}
            />
          )}
        </div>

        {/* Editor panel */}
        <div className="flex-1 overflow-hidden">
          <EditorPanel
            key={project.id}
            project={project}
            files={files}
            fileToOpen={fileToOpen}
            onProjectUpdate={onProjectUpdate}
          />
        </div>
      </div>

      {/* Delete confirmation modal */}
      {confirmDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="max-w-sm w-full mx-4 p-6 bg-gray-900 border border-gray-700 rounded-lg space-y-4">
            <div className="flex items-center gap-2 text-red-400">
              <Trash2 className="w-5 h-5" />
              <h3 className="text-sm font-semibold">Delete project</h3>
            </div>
            <p className="text-sm text-gray-400">
              Are you sure you want to delete <span className="text-gray-100 font-medium">{project.name}</span>?
              This action cannot be undone.
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setConfirmDelete(false)}
                disabled={deleting || projectOperationPending}
                className="flex items-center gap-1 px-3 py-1.5 text-sm text-gray-400 hover:text-gray-200 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <X className="w-3.5 h-3.5" />
                Cancel
              </button>
              <button
                onClick={handleDeleteConfirm}
                disabled={deleting || projectOperationPending}
                className="px-3 py-1.5 text-sm text-white bg-red-700 rounded-md hover:bg-red-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {deleting ? "Deleting..." : "Delete"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** Wrapper to avoid circular import issues. */
function FileTreeWrapper({
  nodes,
  selectedPath,
  onSelect,
}: {
  nodes: ReturnType<typeof buildFileTree>;
  selectedPath: string | null;
  onSelect: (path: string) => void;
}) {
  return <FileTree nodes={nodes} selectedPath={selectedPath} onSelect={onSelect} />;
}
