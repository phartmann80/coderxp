"use client";

/**
 * Agent tool binding for CoderXP M3.5.
 *
 * Builds the AgentToolContext from the live workspace layers and exposes a
 * single `invoke` entry point. This hook owns nothing itself: the runtime, the
 * command controller, and the authoritative file list already exist, and this
 * is the seam that lets an agent reach them under an ownership guard.
 *
 * Ownership: a generation token is bumped on every real project change. A tool
 * call captures the generation and project at invocation; if either moves while
 * the call is in flight, the call reports STALE_OWNERSHIP and stops. That is
 * how a Project A operation is prevented from mutating Project B.
 *
 * No provider calls, no BYOK, no autonomous loop. The M3.7 execution loop and
 * the M3.9 provider adapters will consume `invoke`; they do not exist yet.
 */

import { useCallback, useEffect, useMemo, useRef } from "react";
import { listProjectEntries } from "@/lib/workspace/persistence";
import { getRuntime, getRuntimeKind, type RuntimeState } from "@/lib/workspace/runtime";
import { isProjectPresentInContainer } from "@/lib/workspace/file-sync";
import {
  invokeAgentTool,
  type AgentToolContext,
} from "@/lib/workspace/agent-tool-handlers";
import {
  AGENT_TOOLS,
  type AgentToolDefinition,
  type AgentToolResult,
  type RuntimeStatusData,
} from "@/lib/workspace/agent-tools";

export interface AgentToolsApi {
  /** The tool manifest, for the M3.6 permission UI and the M3.9 adapters. */
  tools: readonly AgentToolDefinition[];
  /** Invoke a tool by name. Never throws for expected failures. */
  invoke: (name: string, params?: unknown) => Promise<AgentToolResult<unknown>>;
  /** Invalidate in-flight tool calls. Only for a real project change. */
  invalidateProject: () => void;
}

export interface UseAgentToolsOptions {
  projectId: string;
  templateId: string | null;
  /** Live runtime state from useRuntime. */
  runtimeState: RuntimeState;
  /** Live preview URL from useRuntime, or null. */
  previewUrl: string | null;
  /** Live runtime error from useRuntime, or null. */
  runtimeError: string | null;
  /** Refresh the workspace's authoritative file list. */
  onRefreshFiles: () => Promise<void>;
  /** Start the project. Supplied by useRuntime so flush-before-run is preserved. */
  onRunProject: () => Promise<void>;
  /** Stop the project. Supplied by useRuntime. */
  onStopProject: () => Promise<void>;
}

export function useAgentTools(options: UseAgentToolsOptions): AgentToolsApi {
  const {
    projectId,
    templateId,
    runtimeState,
    previewUrl,
    runtimeError,
    onRefreshFiles,
    onRunProject,
    onStopProject,
  } = options;

  /** Bumped on every real project change. Stale calls must stop. */
  const generationRef = useRef(0);
  const projectIdRef = useRef(projectId);

  // Live values read at call time rather than captured in a closure, so a
  // long-running tool call observes current runtime state, not stale state.
  const runtimeStateRef = useRef(runtimeState);
  runtimeStateRef.current = runtimeState;
  const previewUrlRef = useRef(previewUrl);
  previewUrlRef.current = previewUrl;
  const runtimeErrorRef = useRef(runtimeError);
  runtimeErrorRef.current = runtimeError;
  const templateIdRef = useRef(templateId);
  templateIdRef.current = templateId;

  const refreshFilesRef = useRef(onRefreshFiles);
  refreshFilesRef.current = onRefreshFiles;
  const runProjectRef = useRef(onRunProject);
  runProjectRef.current = onRunProject;
  const stopProjectRef = useRef(onStopProject);
  stopProjectRef.current = onStopProject;

  const invalidateProject = useCallback(() => {
    generationRef.current += 1;
  }, []);

  // Real project switches only. A rerender must not invalidate an active call.
  useEffect(() => {
    if (projectIdRef.current === projectId) return;
    projectIdRef.current = projectId;
    invalidateProject();
  }, [projectId, invalidateProject]);

  const invoke = useCallback(
    async (name: string, params?: unknown): Promise<AgentToolResult<unknown>> => {
      const generation = generationRef.current;
      const owner = projectId;

      const ownsCall = () =>
        generationRef.current === generation && projectIdRef.current === owner;

      const ctx: AgentToolContext = {
        projectId: owner,

        ownsCall,

        refreshFiles: async () => {
          if (!ownsCall()) return;
          await refreshFilesRef.current();
        },

        // Pushes authoritative source into the shared container. Uses
        // syncProject, never mountProject, so node_modules survives; and it
        // does nothing when no project is mounted, so it cannot boot a second
        // container.
        syncProjectSource: async () => {
          if (!ownsCall()) return;
          const runtime = getRuntime();
          if (!runtime.isMounted()) return;
          const files = await listProjectEntries(owner);
          if (!ownsCall()) return;
          const kind = getRuntimeKind(templateIdRef.current ?? "static-html");
          await runtime.syncProject(files, kind);
        },

        getRuntimeStatus: (): RuntimeStatusData => ({
          state: runtimeStateRef.current,
          previewUrl: previewUrlRef.current,
          mounted: isProjectPresentInContainer(),
          error: runtimeErrorRef.current,
        }),

        runProject: async () => {
          await runProjectRef.current();
        },

        stopProject: async () => {
          await stopProjectRef.current();
        },
      };

      return invokeAgentTool(ctx, name, params);
    },
    [projectId],
  );

  return useMemo(
    () => ({ tools: AGENT_TOOLS, invoke, invalidateProject }),
    [invoke, invalidateProject],
  );
}
