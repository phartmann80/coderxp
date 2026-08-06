"use client";

/**
 * Open-project shell for CoderXP M2 Workspace Alpha.
 *
 * Commit 3 correction scope:
 * - Rename mode closes only after successful rename (correction 4).
 * - Rename text remains available after failure.
 * - Delete confirmation closes only after successful deletion.
 * - Selected-file summary shows the actual stored kind (file/directory)
 *   (correction 7).
 *
 * Does NOT include:
 * - CodeMirror or editable file contents
 * - Terminal, preview panel, run button, fake build status, or fake output
 */

import { useMemo, useState } from "react";
import {
  ArrowLeft,
  HardDrive,
  Pencil,
  Trash2,
  X,
  File as FileIcon,
  Folder,
} from "lucide-react";
import type { WorkspaceProject, WorkspaceFileRecord } from "@/lib/workspace/types";
import { buildFileTree } from "@/lib/workspace/project-tree";
import { FileTree } from "./FileTree";

interface ProjectShellProps {
  project: WorkspaceProject;
  files: WorkspaceFileRecord[];
  renaming: boolean;
  deleting: boolean;
  onBack: () => void;
  onRename: (newName: string) => Promise<boolean>;
  onDelete: () => Promise<boolean>;
}

export function ProjectShell({
  project,
  files,
  renaming,
  deleting,
  onBack,
  onRename,
  onDelete,
}: ProjectShellProps) {
  const [selectedPath, setSelectedPath] = useState<string | null>(project.activeFile);
  const [renameMode, setRenameMode] = useState(false);
  const [renameValue, setRenameValue] = useState(project.name);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const tree = useMemo(() => buildFileTree(files), [files]);

  const selectedFile = useMemo(
    () => files.find((f) => f.path === selectedPath) ?? null,
    [files, selectedPath],
  );

  const handleRenameSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (renameValue.trim().length === 0 || renaming) return;

    // Correction 4: close rename mode only after successful rename.
    // The onRename callback returns a promise that resolves to true/false.
    const success = await onRename(renameValue);
    if (success) {
      setRenameMode(false);
    }
    // On failure, rename mode stays open and rename text is preserved.
  };

  const handleDeleteConfirm = async () => {
    // Correction 4: close delete confirmation only after successful deletion.
    // The onDelete callback returns a promise that resolves to true/false.
    const success = await onDelete();
    if (success) {
      setConfirmDelete(false);
    }
    // On failure, the confirmation modal stays open with the project context.
  };

  const getFileKind = (path: string): string => {
    const ext = path.split(".").pop()?.toLowerCase();
    switch (ext) {
      case "html": return "HTML";
      case "css": return "CSS";
      case "js": return "JavaScript";
      case "mjs": return "ES Module";
      case "json": return "JSON";
      default: return "File";
    }
  };

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      {/* Project header bar */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-gray-800 bg-gray-900/50">
        <div className="flex items-center gap-3">
          <button
            onClick={onBack}
            className="flex items-center gap-1.5 text-sm text-gray-400 hover:text-gray-200 transition-colors"
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
                className="px-2 py-0.5 text-sm text-gray-100 bg-gray-800 border border-gray-600 rounded focus:outline-none focus:border-cyan-600"
              />
              <button
                type="submit"
                disabled={renaming || renameValue.trim().length === 0}
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
                className="text-xs text-gray-500 hover:text-gray-400"
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
              disabled={renaming}
              className="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-200 transition-colors disabled:opacity-50"
            >
              <Pencil className="w-3.5 h-3.5" />
              Rename
            </button>
          )}
          <button
            onClick={() => setConfirmDelete(true)}
            disabled={deleting}
            className="flex items-center gap-1 text-xs text-red-400 hover:text-red-300 transition-colors disabled:opacity-50"
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
              onSelect={setSelectedPath}
            />
          )}
        </div>

        {/* File summary */}
        <div className="flex-1 p-6 overflow-y-auto">
          {selectedFile ? (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                {selectedFile.kind === "directory" ? (
                  <Folder className="w-4 h-4 text-gray-500" />
                ) : (
                  <FileIcon className="w-4 h-4 text-gray-500" />
                )}
                <span className="text-sm text-gray-100 font-medium">{selectedFile.path}</span>
              </div>
              {/* Correction 7: show the actual stored kind (file/directory) */}
              <div className="text-xs text-gray-500">
                Kind: {selectedFile.kind === "directory" ? "directory" : "file"}
                {selectedFile.kind === "file" && (
                  <span className="text-gray-600"> ({getFileKind(selectedFile.path)})</span>
                )}
              </div>
              <div className="text-xs text-gray-600">
                Last modified: {new Date(selectedFile.updatedAt).toLocaleString()}
              </div>
              <p className="text-xs text-gray-600 mt-4">
                File editing is not available in this version. CodeMirror editor will be introduced in a future commit.
              </p>
            </div>
          ) : (
            <div className="flex items-center justify-center h-full">
              <p className="text-sm text-gray-600">Select a file from the tree to view its details.</p>
            </div>
          )}
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
                className="flex items-center gap-1 px-3 py-1.5 text-sm text-gray-400 hover:text-gray-200 transition-colors"
              >
                <X className="w-3.5 h-3.5" />
                Cancel
              </button>
              <button
                onClick={handleDeleteConfirm}
                disabled={deleting}
                className="px-3 py-1.5 text-sm text-white bg-red-700 rounded-md hover:bg-red-600 transition-colors disabled:opacity-50"
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
