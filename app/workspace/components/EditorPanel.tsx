"use client";

/**
 * Editor panel for CoderXP M2 Workspace Alpha.
 *
 * Correction (fix(workspace): make editor persistence lossless):
 *
 * - Uses useEditorPersistence hook for save scheduling, serialization,
 *   and dirty-state management (replaces component-local debounce).
 * - Tab metadata recovery on project open: filters stale paths, directories,
 *   duplicates, and validates activeFile against existing file records.
 * - File-open events use explicit request identity (path + requestId) so
 *   clicking the same file after closing it produces a state transition.
 * - Dirty-tab close flushes pending content before closing; on failure,
 *   the tab stays open and dirty with a visible error.
 * - Back to Projects flushes all dirty files before transitioning; on
 *   failure, stays in the project and surfaces the error.
 * - Save failures surface visible errors; no silent catches.
 * - getEntry failure produces a visible load error, not a fake empty buffer.
 * - beforeunload warning for unsaved changes.
 * - Monotonic project state updates: older revisions cannot replace newer.
 *
 * State reset on project switch is handled by the parent via React key,
 * so this component can safely initialize state from props.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { FileText, AlertCircle, RotateCw } from "lucide-react";
import { EditorTabs } from "./EditorTabs";
import { CodeEditor } from "./CodeEditor";
import { getEntry } from "@/lib/workspace/persistence";
import { useEditorPersistence, type FileOpenRequest } from "@/app/workspace/hooks/useEditorPersistence";
import type { WorkspaceProject, WorkspaceFileRecord } from "@/lib/workspace/types";

interface EditorPanelProps {
  /** The active project. */
  project: WorkspaceProject;
  /** All file records for this project (for tree display). */
  files: WorkspaceFileRecord[];
  /** File open request from the file tree (path + requestId). */
  fileOpenRequest: FileOpenRequest | null;
  /** Called when the project's activeFile or openTabs change. */
  onProjectUpdate: (updated: WorkspaceProject) => void;
  /** Called when the user clicks Back to Projects. */
  onBack: () => void;
}

/** Cache of file contents keyed by path, to avoid re-reading IndexedDB. */
type ContentCache = Map<string, string>;

/** Load error per path. */
type LoadErrorMap = Map<string, string>;

export function EditorPanel({ project, files, fileOpenRequest, onProjectUpdate, onBack }: EditorPanelProps) {
  const persistence = useEditorPersistence(project.id, onProjectUpdate);

  // Sanitize initial openTabs and activeFile from project metadata.
  const sanitizeTabs = useCallback(
    (tabs: string[], active: string | null): { tabs: string[]; active: string | null } => {
      const validFilePaths = new Set<string>();
      for (const f of files) {
        if (f.kind === "file") {
          validFilePaths.add(f.path);
        }
      }

      // Remove missing paths, directories, and duplicates (preserving order).
      const sanitized: string[] = [];
      const seen = new Set<string>();
      for (const tab of tabs) {
        if (validFilePaths.has(tab) && !seen.has(tab)) {
          sanitized.push(tab);
          seen.add(tab);
        }
      }

      // Validate activeFile.
      let sanitizedActive: string | null = null;
      if (active && validFilePaths.has(active)) {
        sanitizedActive = active;
      }

      // Ensure activeFile is in openTabs.
      if (sanitizedActive && !seen.has(sanitizedActive)) {
        sanitized.push(sanitizedActive);
        seen.add(sanitizedActive);
      }

      // Fallback to first valid tab or null.
      if (!sanitizedActive && sanitized.length > 0) {
        sanitizedActive = sanitized[0];
      }

      return { tabs: sanitized, active: sanitizedActive };
    },
    [files],
  );

  const initial = sanitizeTabs(project.openTabs, project.activeFile);

  const [openTabs, setOpenTabs] = useState<string[]>(initial.tabs);
  const [activeFile, setActiveFile] = useState<string | null>(initial.active);
  const [fileContents, setFileContents] = useState<ContentCache>(new Map());
  const [loadErrors, setLoadErrors] = useState<LoadErrorMap>(new Map());
  const [backError, setBackError] = useState<string | null>(null);
  const contentCacheRef = useRef<ContentCache>(new Map());
  const processedRequestRef = useRef<number>(-1);
  const latestProjectRevisionRef = useRef<number>(project.revision);

  // Seed initial buffers from files array (persisted file records).
  useEffect(() => {
    for (const f of files) {
      if (f.kind === "file" && f.contents !== undefined) {
        if (!contentCacheRef.current.has(f.path)) {
          contentCacheRef.current.set(f.path, f.contents);
          persistence.seedBuffer(f.path, f.contents);
        }
      }
    }
  }, [files, persistence]);

  // If initial sanitization changed the metadata, persist the repaired state.
  useEffect(() => {
    if (
      initial.tabs.length !== project.openTabs.length ||
      initial.tabs.some((t, i) => t !== project.openTabs[i]) ||
      initial.active !== project.activeFile
    ) {
      persistence.persistEditorState(initial.tabs, initial.active);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Handle file open requests from the file tree.
  useEffect(() => {
    if (!fileOpenRequest) return;
    if (fileOpenRequest.requestId === processedRequestRef.current) return;
    processedRequestRef.current = fileOpenRequest.requestId;

    const record = files.find((f) => f.path === fileOpenRequest.path);
    if (!record || record.kind !== "file") return;

    const path = fileOpenRequest.path;

    // Defer state updates out of the effect body to avoid cascading renders.
    queueMicrotask(() => {
      setActiveFile(path);
      setOpenTabs((prev) => {
        if (prev.includes(path)) return prev;
        return [...prev, path];
      });

      // Persist the resulting activeFile/openTabs.
      const newTabs = openTabs.includes(path) ? openTabs : [...openTabs, path];
      persistence.persistEditorState(newTabs, path);
    });
  }, [fileOpenRequest, files, openTabs, persistence]);

  // Load file content when activeFile changes.
  useEffect(() => {
    if (!activeFile) return;

    let cancelled = false;

    async function loadContent() {
      // Check cache first.
      const cached = contentCacheRef.current.get(activeFile!);
      if (cached !== undefined) {
        setFileContents((prev) => new Map(prev).set(activeFile!, cached));
        return;
      }

      // Check if we have it in the files array (persisted records).
      const fileRecord = files.find((f) => f.path === activeFile!);
      if (fileRecord && fileRecord.kind === "file" && fileRecord.contents !== undefined) {
        const contents = fileRecord.contents;
        contentCacheRef.current.set(activeFile!, contents);
        persistence.seedBuffer(activeFile!, contents);
        setFileContents((prev) => new Map(prev).set(activeFile!, contents));
        return;
      }

      // Load from IndexedDB.
      try {
        const entry = await getEntry(project.id, activeFile!);
        if (!cancelled && entry.kind === "file") {
          const contents = entry.contents ?? "";
          contentCacheRef.current.set(activeFile!, contents);
          persistence.seedBuffer(activeFile!, contents);
          setFileContents((prev) => new Map(prev).set(activeFile!, contents));
          // Clear any previous load error.
          setLoadErrors((prev) => {
            const next = new Map(prev);
            next.delete(activeFile!);
            return next;
          });
        }
      } catch {
        if (!cancelled) {
          // Visible load error: do NOT create a fake empty editable buffer.
          setLoadErrors((prev) => {
            const next = new Map(prev);
            next.set(activeFile!, "Failed to load file content. The file may be corrupted or missing.");
            return next;
          });
        }
      }
    }

    loadContent();
    return () => {
      cancelled = true;
    };
  }, [activeFile, project.id, files, persistence]);

  // beforeunload warning for unsaved changes.
  useEffect(() => {
    function handleBeforeUnload(e: BeforeUnloadEvent) {
      if (persistence.dirtyPaths.size > 0) {
        e.preventDefault();
        e.returnValue = "";
      }
    }
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
    };
  }, [persistence.dirtyPaths]);

  // Close a file tab.
  const handleCloseTab = useCallback(
    async (path: string) => {
      const tabIndex = openTabs.indexOf(path);
      if (tabIndex === -1) return;

      // Flush pending content before closing.
      const ok = await persistence.flushPath(path);
      if (!ok) {
        // Save failed: keep tab open and dirty with visible error.
        return;
      }

      const nextTabs = openTabs.filter((t) => t !== path);
      let nextActive = activeFile;

      if (activeFile === path) {
        if (nextTabs.length === 0) {
          nextActive = null;
        } else if (tabIndex < nextTabs.length) {
          nextActive = nextTabs[tabIndex];
        } else {
          nextActive = nextTabs[nextTabs.length - 1];
        }
      }

      persistence.clearFile(path);
      contentCacheRef.current.delete(path);
      setFileContents((prev) => {
        const next = new Map(prev);
        next.delete(path);
        return next;
      });
      setLoadErrors((prev) => {
        const next = new Map(prev);
        next.delete(path);
        return next;
      });

      setOpenTabs(nextTabs);
      setActiveFile(nextActive);
      persistence.persistEditorState(nextTabs, nextActive);
    },
    [openTabs, activeFile, persistence],
  );

  // Select a tab (make it active).
  const handleSelectTab = useCallback(
    (path: string) => {
      setActiveFile(path);
      persistence.persistEditorState(openTabs, path);
    },
    [openTabs, persistence],
  );

  // Handle content change from the editor.
  const handleEditorChange = useCallback(
    (val: string) => {
      if (!activeFile) return;
      contentCacheRef.current.set(activeFile, val);
      setFileContents((prev) => new Map(prev).set(activeFile, val));
      persistence.onContentChange(activeFile, val);
    },
    [activeFile, persistence],
  );

  // Handle Back to Projects.
  const handleBack = useCallback(
    async () => {
      setBackError(null);
      const ok = await persistence.flushAll();
      if (ok) {
        onBack();
      } else {
        setBackError("Some files could not be saved. Your changes are preserved in memory. Please retry or fix the issue before leaving.");
      }
    },
    [persistence, onBack],
  );

  // Retry save for a file.
  const handleRetrySave = useCallback(
    (path: string) => {
      persistence.retrySave(path);
    },
    [persistence],
  );

  const currentContent = activeFile ? fileContents.get(activeFile) ?? persistence.getBuffer(activeFile) ?? "" : "";
  const activeLoadError = activeFile ? loadErrors.get(activeFile) ?? null : null;
  const activeSaveError = activeFile ? persistence.saveErrors.get(activeFile) ?? null : null;

  if (!activeFile) {
    return (
      <div className="flex flex-col h-full bg-[#0d0e10]">
        <div className="flex flex-col items-center justify-center h-full text-gray-600">
          <FileText className="w-8 h-8 mb-3 opacity-40" />
          <p className="text-sm">Select a file to start editing</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-[#0d0e10]">
      <EditorTabs
        openTabs={openTabs}
        activeFile={activeFile}
        dirtyPaths={persistence.dirtyPaths}
        onSelect={handleSelectTab}
        onClose={handleCloseTab}
      />
      <div className="flex-1 overflow-hidden">
        <CodeEditor
          filePath={activeFile}
          value={currentContent}
          onChange={handleEditorChange}
        />
      </div>
      {/* Load error banner */}
      {activeLoadError && (
        <div className="flex items-center gap-2 px-3 py-2 bg-red-950/50 border-t border-red-800/50 text-red-300 text-xs">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          <span>{activeLoadError}</span>
        </div>
      )}
      {/* Save error banner with retry */}
      {activeSaveError && (
        <div className="flex items-center gap-2 px-3 py-2 bg-red-950/50 border-t border-red-800/50 text-red-300 text-xs">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          <span className="flex-1">{activeSaveError}</span>
          <button
            onClick={() => handleRetrySave(activeFile)}
            className="flex items-center gap-1 px-2 py-0.5 rounded bg-red-800/50 hover:bg-red-800/70 text-red-200 transition-colors"
          >
            <RotateCw className="w-3 h-3" />
            Retry Save
          </button>
        </div>
      )}
      {/* Back error banner */}
      {backError && (
        <div className="flex items-center gap-2 px-3 py-2 bg-red-950/50 border-t border-red-800/50 text-red-300 text-xs">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          <span className="flex-1">{backError}</span>
          <button
            onClick={() => setBackError(null)}
            className="px-2 py-0.5 rounded bg-red-800/50 hover:bg-red-800/70 text-red-200 transition-colors"
          >
            Dismiss
          </button>
        </div>
      )}
    </div>
  );
}
