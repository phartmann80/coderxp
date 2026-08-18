"use client";

/**
 * React lifecycle adapter for AgentOrchestrator (CoderXP M3.8).
 *
 * Binds the pure iterative agent orchestrator to React components, the project
 * generation counter, the M3.7 execution runtime, and the streaming transport.
 *
 * ProjectShell remains the authoritative lifecycle owner.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AgentOrchestrator,
  type OrchestrationBudgetOptions,
  type OrchestrationState,
  type OrchestratorLifecycleEvent,
} from "@/lib/workspace/agent-orchestrator";
import type { AgentExecutionRuntime } from "@/lib/workspace/agent-execution-runtime";
import type { AgentTransport, CanonicalAgentMessage } from "@/lib/workspace/agent-transport-types";

export interface UseAgentOrchestratorOptions {
  projectId: string;
  generation: number;
  runtime: AgentExecutionRuntime;
  transport?: AgentTransport;
  systemContext?: string;
  budgets?: OrchestrationBudgetOptions;
  onEvent?: (event: OrchestratorLifecycleEvent) => void;
}

export interface AgentOrchestratorApi {
  orchestrator: AgentOrchestrator;
  state: OrchestrationState;
  messages: CanonicalAgentMessage[];
  currentRunId: string | null;
  submitRun: (prompt: string) => { runId: string };
  cancel: (reason?: string) => boolean;
  setTransport: (transport: AgentTransport | null) => void;
}

export function useAgentOrchestrator(
  options: UseAgentOrchestratorOptions,
): AgentOrchestratorApi {
  const {
    projectId,
    generation,
    runtime,
    transport,
    systemContext,
    budgets,
    onEvent,
  } = options;

  const [revision, setRevision] = useState(0);

  const orchestrator = useMemo(() => {
    return new AgentOrchestrator({
      projectId,
      generation,
      runtime,
      transport,
      systemContext,
      budgets,
      onEvent: (event) => {
        setRevision((n) => n + 1);
        onEvent?.(event);
      },
    });
  }, [projectId, generation, runtime, transport, systemContext, budgets, onEvent]);

  // Sync generation changes to orchestrator
  useEffect(() => {
    if (orchestrator.getGeneration() !== generation) {
      orchestrator.invalidateGeneration(generation);
    }
  }, [generation, orchestrator]);

  // Dispose on unmount or runtime/project change
  useEffect(() => {
    return () => {
      orchestrator.dispose();
    };
  }, [orchestrator]);

  const submitRun = useCallback(
    (prompt: string) => {
      return orchestrator.submitRun(prompt);
    },
    [orchestrator],
  );

  const cancel = useCallback(
    (reason?: string) => {
      return orchestrator.cancel(reason);
    },
    [orchestrator],
  );

  const setTransport = useCallback(
    (newTransport: AgentTransport | null) => {
      orchestrator.setTransport(newTransport);
    },
    [orchestrator],
  );

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const state = useMemo(() => orchestrator.getState(), [orchestrator, revision]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const messages = useMemo(() => orchestrator.getMessages(), [orchestrator, revision]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const currentRunId = useMemo(() => orchestrator.getRunId(), [orchestrator, revision]);

  return {
    orchestrator,
    state,
    messages,
    currentRunId,
    submitRun,
    cancel,
    setTransport,
  };
}
