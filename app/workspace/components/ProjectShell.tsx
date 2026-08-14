"use client";

/**
 * Open-project shell for CoderXP M2 Workspace Alpha.
 *
 * Commit 6 scope: adds file & folder management (create, rename, delete)
 * with dirty-file protection, toolbar controls, and inline tree rename.
 *
 * - New File / New Folder / Rename / Delete toolbar in the Files panel.
 * - Uses existing IndexedDB persistence operations (putEntry, renameEntry, deleteEntry).
 * - Dirty editor protection: flushes before rename/delete on dirty files.
 * - After create/rename/delete, refreshes authoritative project entries.
 * - Editor tabs and active-file state follow renamed paths.
 * - Never leaves the editor showing a file that no longer exists.
 * - No automatic Run after filesystem operations.
 *
 * M3.3: wires the local Agent Chat shell (useAgentChat) into RuntimePanel.
 * Additive only — ProjectShell layout is unchanged. No agent loop.
 *
 * M3.4: wires useFileSync for WebContainer -> IndexedDB additive sync.
 */

import { useMemo, useState, useCallback, useRef } from "react";
import {
  HardDrive,
  Pencil,
  Trash2,
  X,
  FilePlus,
  FolderPlus,
  Download,
} from "lucide-react";
import type { WorkspaceProject, WorkspaceFileRecord } from "@/lib/workspace/types";
import { buildFileTree } from "@/lib/workspace/project-tree";
import { FileTree } from "./FileTree";
import { EditorPanel } from "./EditorPanel";
import { RuntimePanel } from "./RuntimePanel";
import { TerminalPanel } from "./TerminalPanel";
import { useRuntime } from "../hooks/useRuntime";
import { useCommands } from "../hooks/useCommands";
import { useAgentChat } from "../hooks/useAgentChat";
import { useFileSync } from "../hooks/useFileSync";
import { getTerminal } from "@/lib/workspace/terminal";
import { getCommandController } from "@/lib/workspace/command-controller";
import {
  putEntry,
  renameEntry,
  deleteEntry,
} from "@/lib/workspace/persistence";
import { isPersistenceError, type PersistenceErrorCode } from "@/lib/workspace/types";
import { getEntryName } from "@/lib/workspace/path-utils";
import { exportProjectZip } from "@/lib/workspace/export";
import type { FileOpenRequest } from "@/app/workspace/hooks/useEditorPersistence";

interface ProjectShellProps {
  project: WorkspaceProject;
  files: WorkspaceFileRecord[];
  renaming: boolean;
  deleting: boolean;
  projectOperationPending: boolean;
  renameSuccessVersion: number;
  /** Increments when the workspace state hook refreshes files. */
  fileOperationVersion: number;
  onBack: () => void;
  onRename: (newName: string) => Promise<boolean>;
  onDelete: () => Promise<boolean>;
  onProjectUpdate: (updated: WorkspaceProject) => void;
  /** Called to trigger a file-list refresh in the parent. */
  onRefreshFiles: () => Promise<void>;
}

/** Controlled error messages for file operations. */
const FILE_ERROR_MESSAGES: Record<PersistenceErrorCode, string> = {
  PERSISTENCE_UNAVAILABLE: "Local storage is not available.",
  DATABASE_OPEN_FAILED: "The local database could not be opened.",
  QUOTA_EXCEEDED: "Storage quota exceeded. Remove unused projects to free space.",
  TRANSACTION_FAILED: "The operation failed. Please try again.",
  PROJECT_NOT_FOUND: "The project was not found.",
  ENTRY_NOT_FOUND: "The file or folder was not found.",
  ENTRY_CONFLICT: "A file or folder with that path already exists.",
  REVISION_CONFLICT: "The project was modified by another operation. Please refresh.",
  INVALID_PROJECT_NAME: "The project name is invalid.",
  INVALID_PATH: "The path is invalid.",
  INVALID_ENTRY: "The entry is invalid.",
  TEMPLATE_UNAVAILABLE: "This template is not available.",
};

function getFileErrorMessage(err: unknown): string {
  if (isPersistenceError(err)) {
    const code = (err as { code: PersistenceErrorCode }).code;
    return FILE_ERROR_MESSAGES[code] ?? "The operation failed.";
  }
  return "The operation failed.";
}

export function ProjectShell({
  project,
  files,
  renaming,
  deleting,
  projectOperationPending,
  renameSuccessVersion,
  fileOperationVersion,
  onBack,
  onRename,
  onDelete,
  onProjectUpdate,
  onRefreshFiles,
}: ProjectShellProps) {
  const [selectedPath, setSelectedPath] = useState<string | null>(project.activeFile);
  const [fileOpenRequest, setFileOpenRequest] = useState<FileOpenRequest | null>(null);
  const fileOpenCounterRef = useRef(0);
  const [renameMode, setRenameMode] = useState(false);
  const [renameValue, setRenameValue] = useState(project.name);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // File operation state.
  const [newFileMode, setNewFileMode] = useState(false);
  const [newFileValue, setNewFileValue] = useState("");
  const [newFolderMode, setNewFolderMode] = useState(false);
  const [newFolderValue, setNewFolderValue] = useState("");
  const [fileOpError, setFileOpError] = useState<string | null>(null);
  const [fileOpInProgress, setFileOpInProgress] = useState(false);

  // Entry delete confirmation.
  const [entryToDelete, setEntryToDelete] = useState<string | null>(null);
  const [entryDeleteInProgress, setEntryDeleteInProgress] = useState(false);

  // Export state.
  const [exportState, setExportState] = useState<"idle" | "exporting" | "error">("idle");
  const [exportError, setExportError] = useState<string | null>(null);

  // Ref to hold the flushAll function from EditorPanel's persistence hook.
  const flushAllRef = useRef<(() => Promise<boolean>) | null>(null);

  const runtime = useRuntime(project.id, files, async () => {
    return flushAllRef.current ? flushAllRef.current() : Promise.resolve(true);
  }, project.templateId);

  const commands = useCommands();
  const chat = useAgentChat(project.id);
  // Auto-sync is effect-driven inside the hook (command complete / Run complete).
  useFileSync(
    project.id,
    commands.commands,
    runtime.state,
    onRefreshFiles,
  );

  // Handle running a command from the CommandPanel.
  const handleCommandRun = async (input: string) => {
    // Flush editor buffers before running a command that depends on source.
    const ok = flushAllRef.current ? await flushAllRef.current() : true;
    if (!ok) return;

    // Sync project files into WebContainer if already mounted.
    if (runtime.state !== "idle" || runtime.isRunning) {
      // Runtime is active — project is already mounted.
    }

    // Parse the command string into command + args.
    const parts = input.trim().split(/\s+/);
    const cmd = parts[0];
    const args = parts.slice(1);

    await commands.runCommand({
      command: cmd,
      args,
      owner: "user",
    });
  };

  // Close rename mode and sync the displayed name when rename succeeds.
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
    await onRename(renameValue);
  };

  const handleDeleteConfirm = async () => {
    if (projectOperationPending) return;
    const success = await onDelete();
    if (success) {
      setConfirmDelete(false);
    }
  };

  const handleFileSelect = useCallback((path: string) => {
    setSelectedPath(path);
    const record = files.find((f) => f.path === path);
    if (record && record.kind === "file") {
      fileOpenCounterRef.current++;
      setFileOpenRequest({ path, requestId: fileOpenCounterRef.current });
    }
  }, [files]);

  // -------------------------------------------------------------------------
  // File & folder management
  // -------------------------------------------------------------------------

  /** Refresh the authoritative project entries and update workspace state. */
  const refreshProjectFiles = useCallback(async (): Promise<void> => {
    await onRefreshFiles();
  }, [onRefreshFiles]);

  /** Open a file in the editor and make it active. */
  const openFileInEditor = useCallback((path: string) => {
    setSelectedPath(path);
    fileOpenCounterRef.current++;
    setFileOpenRequest({ path, requestId: fileOpenCounterRef.current });
  }, []);

  // --- New File ---

  const handleNewFileSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = newFileValue.trim();
    if (trimmed.length === 0 || fileOpInProgress) return;

    setFileOpInProgress(true);
    setFileOpError(null);

    try {
      // Flush all dirty buffers before remounting EditorPanel.
      if (flushAllRef.current) {
        const flushOk = await flushAllRef.current();
        if (!flushOk) {
          setFileOpError("Could not save all files. Your changes are preserved.");
          return;
        }
      }

      await putEntry(project.id, trimmed, "file", "");
      await refreshProjectFiles();

      // Open the new file in the editor.
      openFileInEditor(trimmed);

      setNewFileMode(false);
      setNewFileValue("");
    } catch (err) {
      setFileOpError(getFileErrorMessage(err));
    } finally {
      setFileOpInProgress(false);
    }
  };

  // --- New Folder ---

  const handleNewFolderSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = newFolderValue.trim();
    if (trimmed.length === 0 || fileOpInProgress) return;

    // Folder paths should end with a trailing slash for the persistence layer.
    // The path validator rejects trailing "/", so we strip it before putEntry.
    const folderPath = trimmed.endsWith("/") ? trimmed.slice(0, -1) : trimmed;

    setFileOpInProgress(true);
    setFileOpError(null);

    try {
      // Flush all dirty buffers before remounting EditorPanel.
      if (flushAllRef.current) {
        const flushOk = await flushAllRef.current();
        if (!flushOk) {
          setFileOpError("Could not save all files. Your changes are preserved.");
          return;
        }
      }

      await putEntry(project.id, folderPath, "directory");
      await refreshProjectFiles();

      setNewFolderMode(false);
      setNewFolderValue("");
    } catch (err) {
      setFileOpError(getFileErrorMessage(err));
    } finally {
      setFileOpInProgress(false);
    }
  };

  // --- Rename Entry (from FileTree inline) ---

  const handleEntryRename = useCallback(
    async (oldPath: string, newPath: string): Promise<boolean> => {
      if (fileOpInProgress) return false;
      setFileOpInProgress(true);
      setFileOpError(null);

      try {
        // Flush all dirty buffers before remounting EditorPanel.
        if (flushAllRef.current) {
          const flushOk = await flushAllRef.current();
          if (!flushOk) {
            setFileOpError("Could not save all files. Your changes are preserved.");
            return false;
          }
        }

        await renameEntry(project.id, oldPath, newPath);
        await refreshProjectFiles();

        return true;
      } catch (err) {
        setFileOpError(getFileErrorMessage(err));
        return false;
      } finally {
        setFileOpInProgress(false);
      }
    },
    [fileOpInProgress, project.id, refreshProjectFiles],
  );

  // --- Delete Entry (from FileTree or toolbar) ---

  const handleEntryDeleteRequest = useCallback((path: string) => {
    setEntryToDelete(path);
    setFileOpError(null);
  }, []);

  const handleEntryDeleteConfirm = async () => {
    if (!entryToDelete || entryDeleteInProgress) return;

    setEntryDeleteInProgress(true);
    setFileOpError(null);

    try {
      // Flush all dirty buffers before remounting EditorPanel.
      if (flushAllRef.current) {
        const flushOk = await flushAllRef.current();
        if (!flushOk) {
          setFileOpError("Could not save all files. Your changes are preserved.");
          return;
        }
      }

      await deleteEntry(project.id, entryToDelete);
      await refreshProjectFiles();

      setEntryToDelete(null);
    } catch (err) {
      setFileOpError(getFileErrorMessage(err));
    } finally {
      setEntryDeleteInProgress(false);
    }
  };

  // -------------------------------------------------------------------------
  // Export
  // -------------------------------------------------------------------------

  const handleExport = useCallback(async () => {
    if (exportState === "exporting") return;
    setExportState("exporting");
    setExportError(null);

    try {
      const flushFn = flushAllRef.current ?? (() => Promise.resolve(true));
      const result = await exportProjectZip(project.id, project.name, flushFn);
      if (result.ok) {
        setExportState("idle");
      } else {
        setExportState("error");
        setExportError(result.error);
      }
    } catch {
      setExportState("error");
      setExportError("Export failed unexpectedly.");
    }
  }, [exportState, project.id, project.name]);

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      {/* Project header bar */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-gray-800 bg-gray-900/50">
        <div className="flex items-center gap-3">
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
          <button
            onClick={handleExport}
            disabled={exportState === "exporting" || projectOperationPending}
            className="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-200 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            aria-label="Export ZIP"
            title="Export project as ZIP"
          >
            <Download className="w-3.5 h-3.5" />
            {exportState === "exporting" ? "Exporting..." : "Export"}
          </button>
        </div>
      </div>

      {/* Main content: file tree + file summary */}
      <div className="flex flex-1 overflow-hidden">
        {/* File tree sidebar */}
        <div className="w-64 border-r border-gray-800 bg-gray-900/30 overflow-y-auto p-2 flex flex-col">
          <div className="flex items-center justify-between px-2 py-1.5 mb-1">
            <span className="text-xs text-gray-600 uppercase tracking-wide">Files</span>
            {/* Toolbar: New File, New Folder */}
            <div className="flex items-center gap-1">
              <button
                onClick={() => {
                  setNewFileMode(true);
                  setNewFileValue("");
                  setNewFolderMode(false);
                  setFileOpError(null);
                }}
                disabled={fileOpInProgress || projectOperationPending}
                className="p-1 text-gray-500 hover:text-gray-300 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                aria-label="New File"
                title="New File"
              >
                <FilePlus className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => {
                  setNewFolderMode(true);
                  setNewFolderValue("");
                  setNewFileMode(false);
                  setFileOpError(null);
                }}
                disabled={fileOpInProgress || projectOperationPending}
                className="p-1 text-gray-500 hover:text-gray-300 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                aria-label="New Folder"
                title="New Folder"
              >
                <FolderPlus className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* New file input */}
          {newFileMode && (
            <form onSubmit={handleNewFileSubmit} className="px-2 py-1">
              <input
                type="text"
                value={newFileValue}
                onChange={(e) => setNewFileValue(e.target.value)}
                placeholder="path/to/file.html"
                maxLength={1024}
                autoFocus
                disabled={fileOpInProgress}
                className="w-full px-2 py-1 text-xs text-gray-100 bg-gray-800 border border-gray-600 rounded focus:outline-none focus:border-cyan-600 disabled:opacity-50"
              />
              <div className="flex items-center gap-2 mt-1">
                <button
                  type="submit"
                  disabled={fileOpInProgress || newFileValue.trim().length === 0}
                  className="text-xs text-cyan-500 hover:text-cyan-400 disabled:opacity-50"
                >
                  {fileOpInProgress ? "Creating..." : "Create"}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setNewFileMode(false);
                    setNewFileValue("");
                  }}
                  disabled={fileOpInProgress}
                  className="text-xs text-gray-500 hover:text-gray-400 disabled:opacity-50"
                >
                  Cancel
                </button>
              </div>
            </form>
          )}

          {/* New folder input */}
          {newFolderMode && (
            <form onSubmit={handleNewFolderSubmit} className="px-2 py-1">
              <input
                type="text"
                value={newFolderValue}
                onChange={(e) => setNewFolderValue(e.target.value)}
                placeholder="folder/name"
                maxLength={1024}
                autoFocus
                disabled={fileOpInProgress}
                className="w-full px-2 py-1 text-xs text-gray-100 bg-gray-800 border border-gray-600 rounded focus:outline-none focus:border-cyan-600 disabled:opacity-50"
              />
              <div className="flex items-center gap-2 mt-1">
                <button
                  type="submit"
                  disabled={fileOpInProgress || newFolderValue.trim().length === 0}
                  className="text-xs text-cyan-500 hover:text-cyan-400 disabled:opacity-50"
                >
                  {fileOpInProgress ? "Creating..." : "Create"}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setNewFolderMode(false);
                    setNewFolderValue("");
                  }}
                  disabled={fileOpInProgress}
                  className="text-xs text-gray-500 hover:text-gray-400 disabled:opacity-50"
                >
                  Cancel
                </button>
              </div>
            </form>
          )}

          {/* File operation error */}
          {fileOpError && (
            <div className="flex items-center gap-1.5 px-2 py-1.5 mt-1 bg-red-950/50 border border-red-800/50 rounded text-red-300 text-xs">
              <span className="flex-1">{fileOpError}</span>
              <button
                onClick={() => setFileOpError(null)}
                className="px-1 py-0.5 rounded bg-red-800/50 hover:bg-red-800/70 text-red-200 transition-colors"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          )}

          {/* File tree */}
          <div className="flex-1 overflow-y-auto">
            {tree.length === 0 ? (
              <p className="text-xs text-gray-600 italic px-2 py-1">No files in this project.</p>
            ) : (
              <FileTreeWrapper
                nodes={tree}
                selectedPath={selectedPath}
                onSelect={handleFileSelect}
                onRename={handleEntryRename}
                onDelete={handleEntryDeleteRequest}
              />
            )}
          </div>
        </div>

        {/* Editor + Runtime panel (editor on top, runtime below) */}
        <div className="flex flex-1 flex-col overflow-hidden">
          <div className="flex-1 overflow-hidden">
            <EditorPanel
              key={`${project.id}-${fileOperationVersion}`}
              project={project}
              files={files}
              fileOpenRequest={fileOpenRequest}
              onProjectUpdate={onProjectUpdate}
              onBack={onBack}
              projectOperationPending={projectOperationPending}
              flushAllRef={flushAllRef}
            />
          </div>
          {/* Runtime panel: Output + Preview */}
          <div className="h-[280px] flex-shrink-0">
            <RuntimePanel
              output={runtime.output}
              previewUrl={runtime.previewUrl}
              runtimeState={runtime.state}
              isStarting={runtime.isStarting}
              isRunning={runtime.isRunning}
              previewKey={runtime.previewKey}
              onRun={runtime.run}
              onStop={runtime.stop}
              onRefresh={runtime.refreshPreview}
              commands={commands.commands}
              commandsRunning={commands.isRunning}
              onCommandRun={handleCommandRun}
              onCommandCancel={commands.cancelCommand}
              onCommandClear={commands.clearCompleted}
              chatMessages={chat.messages}
              onChatSend={chat.send}
              onChatClear={chat.clear}
            />
          </div>
        </div>
      </div>

      {/* Export error banner */}
      {exportState === "error" && exportError && (
        <div className="flex items-center gap-2 px-4 py-2 bg-red-950/50 border-b border-red-800/50 text-red-300 text-xs">
          <span className="flex-1">Export failed: {exportError}</span>
          <button
            onClick={() => {
              setExportState("idle");
              setExportError(null);
            }}
            className="px-2 py-0.5 rounded bg-red-800/50 hover:bg-red-800/70 text-red-200 transition-colors"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Entry delete confirmation modal */}
      {entryToDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="max-w-sm w-full mx-4 p-6 bg-gray-900 border border-gray-700 rounded-lg space-y-4">
            <div className="flex items-center gap-2 text-red-400">
              <Trash2 className="w-5 h-5" />
              <h3 className="text-sm font-semibold">Delete {getEntryName(entryToDelete)}</h3>
            </div>
            <p className="text-sm text-gray-400">
              Are you sure you want to delete{" "}
              <span className="text-gray-100 font-mono">{entryToDelete}</span>?
              {files.find((f) => f.path === entryToDelete)?.kind === "directory" &&
                " All contents inside this folder will be removed."}
              {" This action cannot be undone."}
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setEntryToDelete(null)}
                disabled={entryDeleteInProgress}
                className="flex items-center gap-1 px-3 py-1.5 text-sm text-gray-400 hover:text-gray-200 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <X className="w-3.5 h-3.5" />
                Cancel
              </button>
              <button
                onClick={handleEntryDeleteConfirm}
                disabled={entryDeleteInProgress}
                className="px-3 py-1.5 text-sm text-white bg-red-700 rounded-md hover:bg-red-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {entryDeleteInProgress ? "Deleting..." : "Delete"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Project delete confirmation modal */}
      {confirmDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="max-w-sm w-full mx-4 p-6 bg-gray-900 border border-gray-700 rounded-lg space-y-4">
            <div className="flex items-center gap-2 text-red-400">
              <Trash2 className="w-5 h-5" />
              <h3 className="text-sm font-semibold">Delete project</h3>
            </div>
            <p className="text-sm text-gray-400">
              Are you sure you want to delete{" "}
              <span className="text-gray-100 font-medium">{project.name}</span>?
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
  onRename,
  onDelete,
}: {
  nodes: ReturnType<typeof buildFileTree>;
  selectedPath: string | null;
  onSelect: (path: string) => void;
  onRename: (oldPath: string, newPath: string) => Promise<boolean>;
  onDelete: (path: string) => void;
}) {
  return (
    <FileTree
      nodes={nodes}
      selectedPath={selectedPath}
      onSelect={onSelect}
      onRename={onRename}
      onDelete={onDelete}
    />
  );
}
