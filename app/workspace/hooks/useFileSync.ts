"use client";

/**
 * Filesystem sync hook for CoderXP M3.4.
 *
 * Syncs WebContainer source files into IndexedDB after a completed
 * command (and after Run completes). Sync is allowed when the active
 * project is present in the shared WebContainer (isMounted), including
 * when Preview/runtime is currently idle — not only when runtime
 * state === "running".
 *
 * Contract:
 * - container -> IndexedDB additions YES
 * - container -> IndexedDB updates YES
 * - missing container file -> IndexedDB deletion NO
 *
 * Does not boot a second WebContainer.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { CommandResult } from "@/lib/workspace/command-controller";
import type { RuntimeState } from "@/lib/workspace/runtime";
import {
  isProjectPresentInContainer,
  syncContainerToIndexedDB,
  type FileSyncResult,
} from "@/lib/workspace/file-sync";

export type FileSyncStatus = "idle" | "syncing" | "error";

export interface FileSyncApi {
  /** Current sync status. */
  status: FileSyncStatus;
  /** Last successful sync result, or null. */
  lastResult: FileSyncResult | null;
  /** Last sync error message, or null. */
  error: string | null;
  /** Count of files added or updated in the last successful sync. */
  syncedCount: number;
  /** Run a sync pass now if the project is present in the container. */
  syncNow: () => Promise<void>;
  /**
   * Invalidate in-flight sync bookkeeping for a project switch.
   * Must only be used on a real project change.
   */
  invalidateProject: () => void;
}

/**
 * WebContainer -> IndexedDB sync, keyed to the open project.
 *
 * `onFilesChanged` is invoked after a sync that actually wrote files
 * so the caller can refresh the authoritative file list.
 */
export function useFileSync(
  projectId: string,
  commands: CommandResult[],
  runtimeState: RuntimeState,
  onFilesChanged?: () => void,
): FileSyncApi {
  const [status, setStatus] = useState<FileSyncStatus>("idle");
  const [lastResult, setLastResult] = useState<FileSyncResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const syncingRef = useRef(false);
  const onFilesChangedRef = useRef(onFilesChanged);
  onFilesChangedRef.current = onFilesChanged;

  const invalidateProject = useCallback(() => {
    setStatus("idle");
    setLastResult(null);
    setError(null);
  }, []);

  // First-cut project reset. Commit 3 hardens this with a projectId ref
  // so status/progress rerenders cannot re-fire invalidation.
  useEffect(() => {
    invalidateProject();
  }, [projectId, invalidateProject]);

  const syncNow = useCallback(async () => {
    if (!projectId) return;
    if (!isProjectPresentInContainer()) return;
    if (syncingRef.current) return;

    syncingRef.current = true;
    setStatus("syncing");
    setError(null);

    try {
      const result = await syncContainerToIndexedDB(projectId);
      setLastResult(result);
      setStatus("idle");
      if (result.added > 0 || result.updated > 0) {
        onFilesChangedRef.current?.();
      }
    } catch (err) {
      setStatus("error");
      setError(err instanceof Error ? err.message : "File sync failed.");
    } finally {
      syncingRef.current = false;
    }
  }, [projectId]);

  const completedKey = commands
    .filter((c) => c.state === "exited" || c.state === "failed" || c.state === "cancelled")
    .map((c) => c.id)
    .join(",");

  // Auto-sync after a completed command when the project is mounted,
  // even if Preview/runtime is idle.
  useEffect(() => {
    if (!completedKey) return;
    void syncNow();
  }, [completedKey, syncNow]);

  const prevRuntimeRef = useRef(runtimeState);
  useEffect(() => {
    const prev = prevRuntimeRef.current;
    prevRuntimeRef.current = runtimeState;

    // Also sync after Run completes (process reached running or returned to idle).
    const runFinished =
      (prev === "starting" || prev === "installing") && runtimeState === "running";
    const runStopped = prev === "running" && runtimeState === "idle";
    if (runFinished || runStopped) {
      void syncNow();
    }
  }, [runtimeState, syncNow]);

  return {
    status,
    lastResult,
    error,
    syncedCount: lastResult ? lastResult.added + lastResult.updated : 0,
    syncNow,
    invalidateProject,
  };
}
