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
 *
 * fix(workspace): coordinate agent tools with editor state
 *
 * Exposes `invalidatePathsRef` alongside the existing `flushAllRef`. When an
 * agent tool mutates a file, the parent calls it with the affected paths; this
 * component then drops the per-file buffer through the existing
 * `persistence.clearFile`, clears the content cache, and forces the next load
 * to come from IndexedDB. Without this, `seedBuffer` early-returns on an
 * existing buffer and the content cache is `has`-guarded, so an open tab would
 * keep its pre-agent buffer and could debounce it back over the agent's write.
 */

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { FileText, AlertCircle, RotateCw, ArrowLeft } from "lucide-react";
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
  /** Called when the user clicks Back to Projects (after flush). */
  onBack: () => void;
  /** Whether project operations are pending (disables Back). */
  projectOperationPending: boolean;
  /** Ref to receive the flushAll function for runtime use. */
  flushAllRef: RefObject<(() => Promise<boolean>) | null>;
  /**
   * Ref to receive the editor-invalidation function for agent tool use.
   * Called with the paths an agent mutated so their buffers and cached
   * contents are dropped and reloaded from authoritative storage.
   */
  invalidatePathsRef: RefObject<((paths: string[]) => void) | null>;
}

/** Cache of file contents keyed by path, to avoid re-reading IndexedDB. */
type ContentCache = Map<string, string>;

/** Load error per path. */
type LoadErrorMap = Map<string, string>;

export function EditorPanel({ project, files, fileOpenRequest, onProjectUpdate, onBack, projectOperationPending, flushAllRef, invalidatePathsRef }: EditorPanelProps) {
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

  // Paths an agent mutated. Until one is reloaded from IndexedDB it must not
  // be served from the content cache or seeded from the `files` prop, because
  // either may still describe the pre-mutation version.
  const forcedReloadRef = useRef<Set<string>>(new Set());
  const [reloadToken, setReloadToken] = useState(0);

  // Seed initial buffers from files array (persisted file records).
  useEffect(() => {
    for (const f of files) {
      if (f.kind === "file" && f.contents !== undefined) {
        if (forcedReloadRef.current.has(f.path)) continue;
        if (!contentCacheRef.current.has(f.path)) {
          contentCacheRef.current.set(f.path, f.contents);
          persistence.seedBuffer(f.path, f.contents);
        }
      }
    }
  }, [files, persistence]);

  /**
   * Drops every trace of the given paths from editor state: the pending
   * debounce and per-file buffer (via the existing clearFile), the content
   * cache, and the rendered contents. The next render reloads them from
   * IndexedDB, which the agent has already made authoritative.
   *
   * This is what prevents a pre-agent buffer from later debouncing back over
   * an agent write.
   */
  const invalidatePaths = useCallback(
    (paths: string[]) => {
      if (paths.length === 0) return;
      for (const path of paths) {
        forcedReloadRef.current.add(path);
        persistence.clearFile(path);
        contentCacheRef.current.delete(path);
      }
      setFileContents((prev) => {
        const next = new Map(prev);
        for (const path of paths) next.delete(path);
        return next;
      });
      setReloadToken((n) => n + 1);
    },
    [persistence],
  );

  // Expose invalidation to the parent so the agent tool bridge can call it.
  useEffect(() => {
    invalidatePathsRef.current = invalidatePaths;
    return () => {
      invalidatePathsRef.current = null;
    };
  }, [invalidatePaths, invalidatePathsRef]);

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

    // An agent mutated this path: neither the cache nor the `files` prop is
    // trustworthy for it, so go straight to IndexedDB.
    const forced = forcedReloadRef.current.has(activeFile);

    async function loadContent() {
      // Check cache first.
      const cached = contentCacheRef.current.get(activeFile!);
      if (!forced && cached !== undefined) {
        setFileContents((prev) => new Map(prev).set(activeFile!, cached));
        return;
      }

      // Check if we have it in the files array (persisted records).
      const fileRecord = files.find((f) => f.path === activeFile!);
      if (!forced && fileRecord && fileRecord.kind === "file" && fileRecord.contents !== undefined) {
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
          // Cleared only after the authoritative read succeeded. A failed read
          // leaves the path forced, so it is never served from a stale cache.
          forcedReloadRef.current.delete(activeFile!);
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
    // reloadToken re-runs this effect after an agent mutation, so the open tab
    // reloads even when activeFile and files are unchanged.
  }, [activeFile, project.id, files, persistence, reloadToken]);

  // Expose flushAll to the parent via ref so the runtime can flush before Run.
  useEffect(() => {
    flushAllRef.current = persistence.flushAll;
    return () => {
      flushAllRef.current = null;
    };
  }, [persistence.flushAll, flushAllRef]);

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
      forcedReloadRef.current.delete(path);
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

  // Handle Back to Projects: flush all dirty files before transitioning.
  const handleBack = useCallback(
    async () => {
      if (projectOperationPending) return;
      setBackError(null);
      const ok = await persistence.flushAll();
      if (ok) {
        onBack();
      } else {
        setBackError("Some files could not be saved. Your changes are preserved in memory. Please retry or fix the issue before leaving.");
      }
    },
    [persistence, onBack, projectOperationPending],
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
        <div className="flex items-center px-4 py-2.5 border-b border-gray-800 bg-gray-900/50">
          <button
            onClick={handleBack}
            disabled={projectOperationPending}
            className="flex items-center gap-1.5 text-sm text-gray-400 hover:text-gray-200 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <ArrowLeft className="w-4 h-4" />
            Projects
          </button>
        </div>
        <div className="flex flex-col items-center justify-center h-full text-gray-600">
          <FileText className="w-8 h-8 mb-3 opacity-40" />
          <p className="text-sm">Select a file to start editing</p>
        </div>
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
        {persistence.metadataError && (
          <div className="flex items-center gap-2 px-3 py-2 bg-red-950/50 border-t border-red-800/50 text-red-300 text-xs">
            <AlertCircle className="w-4 h-4 flex-shrink-0" />
            <span className="flex-1">Workspace metadata was not saved: {persistence.metadataError}</span>
            <button
              onClick={() => persistence.clearMetadataError()}
              className="px-2 py-0.5 rounded bg-red-800/50 hover:bg-red-800/70 text-red-200 transition-colors"
            >
              Dismiss
            </button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-[#0d0e10]">
      <div className="flex items-center px-4 py-2.5 border-b border-gray-800 bg-gray-900/50">
        <button
          onClick={handleBack}
          disabled={projectOperationPending}
          className="flex items-center gap-1.5 text-sm text-gray-400 hover:text-gray-200 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <ArrowLeft className="w-4 h-4" />
          Projects
        </button>
      </div>
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
      {/* Metadata error banner */}
      {persistence.metadataError && (
        <div className="flex items-center gap-2 px-3 py-2 bg-red-950/50 border-t border-red-800/50 text-red-300 text-xs">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          <span className="flex-1">Workspace metadata was not saved: {persistence.metadataError}</span>
          <button
            onClick={() => persistence.clearMetadataError()}
            className="px-2 py-0.5 rounded bg-red-800/50 hover:bg-red-800/70 text-red-200 transition-colors"
          >
            Dismiss
          </button>
        </div>
      )}
    </div>
  );
}
