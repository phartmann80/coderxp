/**
 * Pure transcript projector for CoderXP M3.7 Agent Execution Runtime.
 *
 * Translates append-only AgentExecutionEvents into immutable AgentBlock[] arrays
 * for rendering in the chat panel and durable transcripts.
 *
 * Zero DOM, zero React, pure projection logic.
 */

import type { AgentBlock } from "./agent-protocol";
import type { AgentExecutionEvent } from "./agent-execution-runtime";
import { formatUserFacingResultSummary, formatSafeDiagnostic } from "./agent-sanitizer";

/**
 * Upserts a block into the block list by its stable ID.
 */
function upsertBlock(blocks: readonly AgentBlock[], block: AgentBlock): AgentBlock[] {
  const next = [...blocks];
  const idx = next.findIndex((b) => b.id === block.id);
  if (idx >= 0) {
    next[idx] = block;
  } else {
    next.push(block);
  }
  return next;
}

/**
 * Pure projection function that takes existing transcript blocks and a new lifecycle event,
 * returning the next immutable block list.
 */
export function projectEventToTranscriptBlocks(
  blocks: readonly AgentBlock[],
  event: AgentExecutionEvent,
): AgentBlock[] {
  const { type, toolCallId, attemptId, data } = event;
  const toolName = (data?.toolName as string) || "tool";

  switch (type) {
    case "attempt:running": {
      const toolCallBlock: AgentBlock = {
        id: `tc-${toolCallId}`,
        kind: "tool-call",
        toolCallId,
        name: toolName,
        input: typeof data?.summary === "string" ? data.summary : `Run ${toolName}`,
      };
      return upsertBlock(blocks, toolCallBlock);
    }

    case "attempt:awaiting-approval": {
      const approvalId = (data?.approvalId as string) || attemptId;
      const summary = (data?.summary as string) || `Approval required for ${toolName}`;
      const approvalBlock: AgentBlock = {
        id: `appr-${approvalId}`,
        kind: "approval-requested",
        approvalId,
        summary,
      };
      return upsertBlock(blocks, approvalBlock);
    }

    case "attempt:succeeded": {
      const summary =
        typeof data?.userSummary === "string"
          ? data.userSummary
          : data?.result
            ? formatUserFacingResultSummary(toolName, data.result as any)
            : `Completed ${toolName}`;
      const resultBlock: AgentBlock = {
        id: `res-${toolCallId}`,
        kind: "tool-result",
        toolCallId,
        output: summary,
        isError: false,
      };
      return upsertBlock(blocks, resultBlock);
    }

    case "attempt:failed": {
      const errorMsg =
        typeof data?.errorMessage === "string"
          ? data.errorMessage
          : typeof data?.error === "object" && data?.error !== null
            ? (data.error as any).message || "Tool execution failed"
            : "Tool execution failed";
      const resultBlock: AgentBlock = {
        id: `res-${toolCallId}`,
        kind: "tool-result",
        toolCallId,
        output: `Failed: ${errorMsg}`,
        isError: true,
      };
      return upsertBlock(blocks, resultBlock);
    }

    case "attempt:denied": {
      const reasonMsg =
        typeof data?.message === "string"
          ? data.message
          : "Action denied. It was not performed.";
      const resultBlock: AgentBlock = {
        id: `res-${toolCallId}`,
        kind: "tool-result",
        toolCallId,
        output: reasonMsg,
        isError: true,
      };
      return upsertBlock(blocks, resultBlock);
    }

    case "attempt:cancelled": {
      const cancelBlock: AgentBlock = {
        id: `canc-${attemptId}`,
        kind: "cancellation",
        reason: typeof data?.reason === "string" ? data.reason : "Action cancelled.",
      };
      return upsertBlock(blocks, cancelBlock);
    }

    case "attempt:stale": {
      const staleBlock: AgentBlock = {
        id: `stale-${attemptId}`,
        kind: "cancellation",
        reason:
          typeof data?.message === "string"
            ? data.message
            : "Action cancelled because project changed.",
      };
      return upsertBlock(blocks, staleBlock);
    }

    case "attempt:queued":
    case "attempt:approved":
    default:
      // Internal queue/approval state changes that do not alter transcript blocks
      return [...blocks];
  }
}
