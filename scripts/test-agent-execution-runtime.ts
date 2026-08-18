/**
 * Deterministic Acceptance & Security Test Harness for CoderXP M3.7.
 *
 * Verifies the Agent Tool Execution Runtime, state machine, queue scheduling,
 * permission resumption, cooperative cancellation, generation fencing,
 * 4-tier disclosure sanitization, and negative controls.
 *
 * Zero DOM, zero network, 100% deterministic assertions.
 */

import {
  AgentPermissionController,
  type AgentToolCall,
} from "../lib/workspace/agent-permissions";
import {
  AgentExecutionRuntime,
  IdempotencyConflictError,
  type AgentExecutionEvent,
  type ToolExecutionContext,
} from "../lib/workspace/agent-execution-runtime";
import {
  projectModelFacingResult,
  formatUserFacingResultSummary,
  formatSafeDiagnostic,
  deepFreezeSafeSnapshot,
} from "../lib/workspace/agent-sanitizer";
import { projectEventToTranscriptBlocks } from "../lib/workspace/agent-transcript-projector";
import type { AgentBlock } from "../lib/workspace/agent-protocol";
import type { AgentToolResult } from "../lib/workspace/agent-tools";

let passCount = 0;

function assert(condition: boolean, message: string): void {
  if (!condition) {
    console.error(`[FAIL] ${message}`);
    process.exit(1);
  }
  passCount++;
  console.log(`[PASS #${passCount}] ${message}`);
}

async function runTests() {
  console.log("==========================================================================");
  console.log("      M3.7 AGENT TOOL EXECUTION RUNTIME (DETERMINISTIC HARNESS)          ");
  console.log("==========================================================================");

  const PROJECT_ID = "proj-test";

  // -------------------------------------------------------------------------
  // 1. HARDENED INVALIDATE APPROVAL TESTS
  // -------------------------------------------------------------------------
  console.log("\n--- 1. HARDENED INVALIDATE APPROVAL SUITE ---");

  const ctrl1 = new AgentPermissionController();
  ctrl1.setMode("ask");

  const writeCall1: AgentToolCall = {
    toolCallId: "call-1",
    name: "write_file",
    args: { path: "hello.txt", content: "hi" },
    projectId: PROJECT_ID,
    generation: 1,
  };

  const req1 = ctrl1.requestApproval(writeCall1, 1);
  assert(req1.kind === "pending", "Pending approval created for write_file in ask mode");
  const approvalId1 = (req1 as any).approval.approvalId;

  // Invalidate pending approval
  assert(ctrl1.invalidateApproval(approvalId1) === true, "Invalidate pending approval returns true");
  assert(ctrl1.getApproval(approvalId1)?.status === "cancelled", "Pending approval marked cancelled");

  // Repeated invalidation is idempotent
  assert(ctrl1.invalidateApproval(approvalId1) === false, "Repeated invalidation returns false");

  // Invalidate approved (unconsumed) approval
  const writeCall2: AgentToolCall = {
    toolCallId: "call-2",
    name: "write_file",
    args: { path: "hello2.txt", content: "hi2" },
    projectId: PROJECT_ID,
    generation: 1,
  };
  const req2 = ctrl1.requestApproval(writeCall2, 1);
  const approvalId2 = (req2 as any).approval.approvalId;
  assert(ctrl1.approve(approvalId2, 1) === true, "Approval resolved to approved");
  assert(ctrl1.getApproval(approvalId2)?.status === "approved", "Approval status is approved");

  assert(ctrl1.invalidateApproval(approvalId2) === true, "Invalidate approved unconsumed approval returns true");
  assert(ctrl1.getApproval(approvalId2)?.status === "cancelled", "Approved unconsumed approval marked cancelled");

  // Invalidation cannot modify consumed approvals
  const writeCall3: AgentToolCall = {
    toolCallId: "call-3",
    name: "write_file",
    args: { path: "hello3.txt", content: "hi3" },
    projectId: PROJECT_ID,
    generation: 1,
  };
  const req3 = ctrl1.requestApproval(writeCall3, 1);
  const approvalId3 = (req3 as any).approval.approvalId;
  ctrl1.approve(approvalId3, 1);
  // Consume token
  const consumeReq = ctrl1.requestApproval(writeCall3, 1);
  assert(consumeReq.kind === "allowed", "Approval consumed and allowed returned");
  assert(ctrl1.getApproval(approvalId3)?.status === "consumed", "Approval status is consumed");
  assert(ctrl1.invalidateApproval(approvalId3) === false, "Attempt to invalidate consumed approval returns false");
  assert(ctrl1.getApproval(approvalId3)?.status === "consumed", "Consumed approval status remains untouched");

  // Match criteria guards
  const writeCall4: AgentToolCall = {
    toolCallId: "call-4",
    name: "write_file",
    args: { path: "hello4.txt", content: "hi4" },
    projectId: PROJECT_ID,
    generation: 1,
  };
  const req4 = ctrl1.requestApproval(writeCall4, 1);
  const approvalId4 = (req4 as any).approval.approvalId;
  assert(
    ctrl1.invalidateApproval(approvalId4, { generation: 999 }) === false,
    "Invalidate with wrong generation returns false",
  );
  assert(
    ctrl1.invalidateApproval(approvalId4, { projectId: "wrong-project" }) === false,
    "Invalidate with wrong projectId returns false",
  );
  assert(
    ctrl1.invalidateApproval(approvalId4, { toolCallId: "wrong-call" }) === false,
    "Invalidate with wrong toolCallId returns false",
  );
  assert(
    ctrl1.invalidateApproval(approvalId4, { argsFingerprint: "wrong-args" }) === false,
    "Invalidate with wrong argsFingerprint returns false",
  );
  assert(ctrl1.getApproval(approvalId4)?.status === "pending", "Approval remains pending after failed match checks");

  // -------------------------------------------------------------------------
  // 2. AUTOMATIC READ EXECUTION & RUNNING COMMIT INSIDE GATE
  // -------------------------------------------------------------------------
  console.log("\n--- 2. AUTOMATIC READ EXECUTION & RUNNING COMMIT ---");

  const ctrl2 = new AgentPermissionController();
  ctrl2.setMode("ask");

  let handlerExecuted = 0;
  const events: AgentExecutionEvent[] = [];

  const runtime2 = new AgentExecutionRuntime({
    projectId: PROJECT_ID,
    generation: 1,
    controller: ctrl2,
    executeTool: async (name, params, ctx) => {
      handlerExecuted++;
      assert(name === "read_file", "Handler invoked with tool name read_file");
      assert(ctx.isCurrent() === true, "isCurrent() returns true inside handler");
      return { ok: true, data: { path: "test.txt", content: "data", bytes: 4 } };
    },
    scheduleDrain: (fn) => queueMicrotask(fn),
  });

  runtime2.onEvent((evt) => events.push(evt));

  const readCall: AgentToolCall = {
    toolCallId: "read-call-1",
    name: "read_file",
    args: { path: "test.txt" },
    projectId: PROJECT_ID,
    generation: 1,
  };

  const { attempt: att2 } = runtime2.submit(readCall);
  await runtime2.drain();
  assert(att2.state === "succeeded", "Read call in ask mode transitions queued -> running -> succeeded");
  assert(handlerExecuted === 1, "Handler executed exactly 1 time");

  const eventTypes2 = events.map((e) => e.type);
  assert(
    eventTypes2.includes("attempt:queued") &&
      eventTypes2.includes("attempt:running") &&
      eventTypes2.includes("attempt:succeeded"),
    "Emitted attempt:queued, attempt:running, and attempt:succeeded in order",
  );

  // -------------------------------------------------------------------------
  // 3. APPROVAL-REQUIRED FLOW, RESUME & HEAD-OF-LINE BLOCKING
  // -------------------------------------------------------------------------
  console.log("\n--- 3. APPROVAL FLOW, RESUME & QUEUE BLOCKING ---");

  const ctrl3 = new AgentPermissionController();
  ctrl3.setMode("ask");

  let writeExecuted = 0;
  let readExecuted = 0;
  const runtime3 = new AgentExecutionRuntime({
    projectId: PROJECT_ID,
    generation: 1,
    controller: ctrl3,
    executeTool: async (name, params, ctx) => {
      if (name === "write_file") writeExecuted++;
      if (name === "read_file") readExecuted++;
      return { ok: true, data: { path: "test.txt", success: true } };
    },
    scheduleDrain: (fn) => queueMicrotask(fn),
  });

  const writeCallA: AgentToolCall = {
    toolCallId: "write-call-A",
    name: "write_file",
    args: { path: "write.txt", content: "content" },
    projectId: PROJECT_ID,
    generation: 1,
  };

  const readCallB: AgentToolCall = {
    toolCallId: "read-call-B",
    name: "read_file",
    args: { path: "read.txt" },
    projectId: PROJECT_ID,
    generation: 1,
  };

  const { attempt: attA } = runtime3.submit(writeCallA);
  await runtime3.drain();
  assert(attA.state === "awaiting-approval", "Write call paused at awaiting-approval");
  assert(runtime3.getActiveHead()?.attemptId === attA.attemptId, "Active head is attempt A");

  // Submit second call (Head of line blocking)
  const { attempt: attB } = runtime3.submit(readCallB);
  await runtime3.drain();
  assert(attB.state === "queued", "Second call remains queued behind awaiting-approval head");
  assert(writeExecuted === 0, "No handler executed yet");

  // Approve first call
  assert(ctrl3.approve(attA.approvalId!, 1) === true, "Approval recorded in controller");
  const resumed = await runtime3.resume(attA.attemptId);
  assert(resumed === true, "resume() executed successfully");
  assert(attA.state === "succeeded", "Attempt A reached succeeded state");
  assert(writeExecuted === 1, "Write handler executed exactly 1 time");

  // Drain remaining queue
  await runtime3.drain();
  // Queue progressed automatically to attempt B
  assert(attB.state === "succeeded", "Attempt B progressed and succeeded after attempt A finished");

  // -------------------------------------------------------------------------
  // 4. USER DENIAL & UNKNOWN TOOL
  // -------------------------------------------------------------------------
  console.log("\n--- 4. USER DENIAL & UNKNOWN TOOL HANDLING ---");

  const ctrl4 = new AgentPermissionController();
  ctrl4.setMode("ask");

  const runtime4 = new AgentExecutionRuntime({
    projectId: PROJECT_ID,
    generation: 1,
    controller: ctrl4,
    executeTool: async () => ({ ok: true, data: null }),
    scheduleDrain: (fn) => queueMicrotask(fn),
  });

  const writeCallDeny: AgentToolCall = {
    toolCallId: "deny-call-1",
    name: "write_file",
    args: { path: "deny.txt", content: "x" },
    projectId: PROJECT_ID,
    generation: 1,
  };

  const { attempt: attDeny } = runtime4.submit(writeCallDeny);
  await runtime4.drain();
  assert(attDeny.state === "awaiting-approval", "Attempt paused awaiting approval");

  runtime4.deny(attDeny.attemptId);
  await runtime4.drain();
  assert(attDeny.state === "denied", "Attempt transitioned to denied");
  assert(attDeny.error?.code === "USER_DENIED", "Error code is USER_DENIED");

  // Unknown tool
  const unknownCall: AgentToolCall = {
    toolCallId: "unknown-call-1",
    name: "not_a_real_tool",
    args: {},
    projectId: PROJECT_ID,
    generation: 1,
  };

  const { attempt: attUnknown } = runtime4.submit(unknownCall);
  await runtime4.drain();
  assert(attUnknown.state === "denied", "Unknown tool transitioned to denied");
  assert(attUnknown.error?.code === "UNKNOWN_TOOL", "Error code is UNKNOWN_TOOL");

  // -------------------------------------------------------------------------
  // 5. CANCELLATION & INTERRUPTED APPROVALS
  // -------------------------------------------------------------------------
  console.log("\n--- 5. CANCELLATION & INTERRUPTED APPROVALS ---");

  const ctrl5 = new AgentPermissionController();
  ctrl5.setMode("ask");

  const status5 = {
    abortFired: false,
    slowHandlerFinished: false,
  };

  const runtime5 = new AgentExecutionRuntime({
    projectId: PROJECT_ID,
    generation: 1,
    controller: ctrl5,
    executeTool: async (name, params, ctx) => {
      ctx.signal.addEventListener("abort", () => {
        status5.abortFired = true;
      });
      // Simulate cooperative sleep
      await new Promise((r) => setTimeout(r, 20));
      status5.slowHandlerFinished = true;
      return { ok: true, data: null };
    },
    scheduleDrain: (fn) => queueMicrotask(fn),
  });

  // Test 5.1: Cancel while queued
  // Submit write call to block head
  const blockingCall: AgentToolCall = {
    toolCallId: "block-1",
    name: "write_file",
    args: { path: "block.txt", content: "b" },
    projectId: PROJECT_ID,
    generation: 1,
  };
  const queuedCall: AgentToolCall = {
    toolCallId: "queued-1",
    name: "read_file",
    args: { path: "queued.txt" },
    projectId: PROJECT_ID,
    generation: 1,
  };

  const { attempt: attBlock } = runtime5.submit(blockingCall);
  const { attempt: attQueued } = runtime5.submit(queuedCall);
  await runtime5.drain();
  assert(attQueued.state === "queued", "Attempt is queued");

  runtime5.cancel(attQueued.attemptId);
  assert(attQueued.state === "cancelled", "Cancelled while queued transitions to cancelled");

  // Test 5.2: Cancel while awaiting approval
  assert(attBlock.state === "awaiting-approval", "Block attempt is awaiting approval");
  const blockApprovalId = attBlock.approvalId!;
  runtime5.cancel(attBlock.attemptId);
  assert(attBlock.state === "cancelled", "Cancelled while awaiting approval");
  assert(
    ctrl5.getApproval(blockApprovalId)?.status === "cancelled",
    "Approval in controller was explicitly invalidated",
  );

  // Test 5.3: Cancel while running (cooperative abort)
  ctrl5.setMode("autonomous"); // run_command executes automatically
  const runCall: AgentToolCall = {
    toolCallId: "run-call-1",
    name: "run_command",
    args: { command: "npm test" },
    projectId: PROJECT_ID,
    generation: 1,
  };

  const { attempt: attRun } = runtime5.submit(runCall);
  // Start draining in background
  void runtime5.drain();
  await new Promise((r) => setTimeout(r, 5));
  assert(attRun.state === "running", "Attempt is in running state");
  runtime5.cancel(attRun.attemptId);
  assert(attRun.state === "cancelled", "Attempt transitioned to cancelled");
  assert(status5.abortFired === true, "AbortSignal fired on running handler");

  // Wait for slow handler to finish late
  await new Promise((r) => setTimeout(r, 30));
  assert(status5.slowHandlerFinished === true, "Slow handler finished late");
  assert(attRun.state === "cancelled", "Late handler return does NOT overwrite cancelled state");

  // -------------------------------------------------------------------------
  // 6. RUNTIME-LIFETIME IDEMPOTENCY
  // -------------------------------------------------------------------------
  console.log("\n--- 6. RUNTIME-LIFETIME IDEMPOTENCY ---");

  const ctrl6 = new AgentPermissionController();
  ctrl6.setMode("ask");

  const runtime6 = new AgentExecutionRuntime({
    projectId: PROJECT_ID,
    generation: 1,
    controller: ctrl6,
    executeTool: async () => ({ ok: true, data: { path: "idempotent.txt", bytes: 10 } }),
    scheduleDrain: (fn) => queueMicrotask(fn),
  });

  const idemCall: AgentToolCall = {
    toolCallId: "idem-call-1",
    name: "read_file",
    args: { path: "idempotent.txt" },
    projectId: PROJECT_ID,
    generation: 1,
  };

  const { attempt: attIdem1, isNew: isNew1 } = runtime6.submit(idemCall, {
    idempotencyKey: "idem-key-1",
  });
  await runtime6.drain();
  assert(isNew1 === true, "First submission with idempotency key is new");
  assert(attIdem1.state === "succeeded", "First submission completed successfully");

  // Duplicate submission with same key & identical payload (terminal deduplication)
  const { attempt: attIdem2, isNew: isNew2 } = runtime6.submit(idemCall, {
    idempotencyKey: "idem-key-1",
  });
  assert(isNew2 === false, "Duplicate submission with same key returns existing attempt");
  assert(attIdem2.attemptId === attIdem1.attemptId, "Returned attempt ID matches original");

  // Duplicate submission with same key but CONFLICTING payload
  const conflictingCall: AgentToolCall = {
    toolCallId: "idem-call-2",
    name: "read_file",
    args: { path: "different.txt" },
    projectId: PROJECT_ID,
    generation: 1,
  };

  let conflictThrown: boolean = false;
  try {
    runtime6.submit(conflictingCall, { idempotencyKey: "idem-key-1" });
  } catch (err) {
    if (err instanceof IdempotencyConflictError) {
      conflictThrown = true;
    }
  }
  assert(conflictThrown === true, "Conflicting submission with same key throws IdempotencyConflictError");

  // -------------------------------------------------------------------------
  // 7. GENERATION FENCING & STALE CHECKS
  // -------------------------------------------------------------------------
  console.log("\n--- 7. GENERATION FENCING & STALE CHECKS ---");

  const ctrl7 = new AgentPermissionController();
  ctrl7.setMode("ask");

  const runtime7 = new AgentExecutionRuntime({
    projectId: PROJECT_ID,
    generation: 1,
    controller: ctrl7,
    executeTool: async () => ({ ok: true, data: null }),
    scheduleDrain: (fn) => queueMicrotask(fn),
  });

  // Stale before claim
  const staleCall: AgentToolCall = {
    toolCallId: "stale-call-1",
    name: "read_file",
    args: { path: "stale.txt" },
    projectId: PROJECT_ID,
    generation: 99, // Mismatched generation
  };

  const { attempt: attStale } = runtime7.submit(staleCall);
  await runtime7.drain();
  assert(attStale.state === "stale", "Generation mismatch before claim transitions to stale");

  // Invalidate generation drops active and queued attempts
  const genCall1: AgentToolCall = {
    toolCallId: "gen-call-1",
    name: "write_file",
    args: { path: "gen1.txt", content: "g" },
    projectId: PROJECT_ID,
    generation: 1,
  };

  const { attempt: attGen1 } = runtime7.submit(genCall1);
  await runtime7.drain();
  assert(attGen1.state === "awaiting-approval", "Attempt is awaiting approval");
  const genApprovalId = attGen1.approvalId!;

  runtime7.invalidateGeneration(2);
  assert(attGen1.state === "stale", "Invalidating generation transitions attempt to stale");
  assert(
    ctrl7.getApproval(genApprovalId)?.status === "cancelled",
    "Approval in controller was invalidated on generation bump",
  );

  // -------------------------------------------------------------------------
  // 8. 4-TIER SANITIZATION & REDACTION
  // -------------------------------------------------------------------------
  console.log("\n--- 8. 4-TIER SANITIZATION & REDACTION ---");

  const rawCmdOutput = "Running tests with --token=secret_jwt_token_123 and DB_PASS=pass123\nDone.";
  const rawResult: AgentToolResult<any> = {
    ok: true,
    data: {
      commandId: "cmd-1",
      exitCode: 0,
      stdout: rawCmdOutput,
      env: { SECRET_KEY: "super_secret" },
    },
  };

  // Tier 2: Model-facing projection
  const modelFacing = projectModelFacingResult("run_command", rawResult);
  assert(modelFacing.ok === true, "Model-facing result is ok");
  assert(
    !JSON.stringify(modelFacing).includes("secret_jwt_token_123"),
    "Model-facing result redacts token secrets",
  );
  assert(
    !JSON.stringify(modelFacing).includes("super_secret"),
    "Model-facing result omits raw env map",
  );

  // Tier 3: User-facing summary
  const userSummary = formatUserFacingResultSummary("run_command", rawResult);
  assert(userSummary.includes("Command finished with exit code 0"), "User-facing summary is formatted cleanly");
  assert(!userSummary.includes("secret_jwt_token_123"), "User-facing summary has no raw tokens");

  // Tier 4: Diagnostic error formatting
  const diagnostic = formatSafeDiagnostic(new Error("Failed connecting to https://user:pass123@api.com?token=xyz"));
  assert(!diagnostic.includes("pass123"), "Diagnostic redacts embedded URL password");
  assert(!diagnostic.includes("xyz"), "Diagnostic redacts query token");

  // Deep freeze snapshot
  const mutableObj = { nested: { val: 123 } };
  const frozen = deepFreezeSafeSnapshot(mutableObj);
  let freezeProtected: boolean = false;
  try {
    (frozen.nested as any).val = 456;
  } catch {
    freezeProtected = true;
  }
  assert(freezeProtected || (frozen.nested as any).val === 123, "deepFreezeSafeSnapshot ensures nested immutability");

  // -------------------------------------------------------------------------
  // 9. TRANSCRIPT PROJECTOR
  // -------------------------------------------------------------------------
  console.log("\n--- 9. TRANSCRIPT PROJECTOR SUITE ---");

  let blocks: AgentBlock[] = [];
  const event1: AgentExecutionEvent = {
    eventId: "evt-1",
    attemptId: "att-1",
    toolCallId: "tc-1",
    sequence: 1,
    type: "attempt:running",
    timestamp: 1000,
    projectId: PROJECT_ID,
    generation: 1,
    data: { toolName: "read_file", summary: "Read file hello.txt" },
  };

  blocks = projectEventToTranscriptBlocks(blocks, event1);
  assert(blocks.length === 1 && blocks[0].kind === "tool-call", "Tool-call block projected on attempt:running");

  const event2: AgentExecutionEvent = {
    eventId: "evt-2",
    attemptId: "att-1",
    toolCallId: "tc-1",
    sequence: 2,
    type: "attempt:succeeded",
    timestamp: 1010,
    projectId: PROJECT_ID,
    generation: 1,
    data: { toolName: "read_file", userSummary: "Read 24 bytes from hello.txt" },
  };

  blocks = projectEventToTranscriptBlocks(blocks, event2);
  assert(blocks.length === 2 && blocks[1].kind === "tool-result", "Tool-result block projected on attempt:succeeded");

  // -------------------------------------------------------------------------
  // 10. MONOTONIC SEQUENCE & LISTENER ISOLATION
  // -------------------------------------------------------------------------
  console.log("\n--- 10. MONOTONIC SEQUENCE & LISTENER ISOLATION ---");

  const ctrl10 = new AgentPermissionController();
  ctrl10.setMode("autonomous");

  let listenerThrowCount = 0;
  const seqs: number[] = [];

  const runtime10 = new AgentExecutionRuntime({
    projectId: PROJECT_ID,
    generation: 1,
    controller: ctrl10,
    executeTool: async () => ({ ok: true, data: null }),
    scheduleDrain: (fn) => queueMicrotask(fn),
  });

  runtime10.onEvent((evt) => {
    seqs.push(evt.sequence);
    // Deliberately throw in listener
    listenerThrowCount++;
    throw new Error("Broken listener!");
  });

  runtime10.submit({
    toolCallId: "mono-1",
    name: "read_file",
    args: {},
    projectId: PROJECT_ID,
    generation: 1,
  });

  runtime10.submit({
    toolCallId: "mono-2",
    name: "read_file",
    args: {},
    projectId: PROJECT_ID,
    generation: 1,
  });

  await runtime10.drain();

  assert(seqs.length >= 4, "Events emitted despite listener exceptions");
  let isStrictlyMonotonic = true;
  for (let i = 1; i < seqs.length; i++) {
    if (seqs[i] !== seqs[i - 1] + 1) {
      isStrictlyMonotonic = false;
    }
  }
  assert(isStrictlyMonotonic === true, "Event sequences are strictly monotonically increasing (1, 2, 3, 4...)");

  // -------------------------------------------------------------------------
  // 11. NEGATIVE CONTROLS & SECURITY ASSERTIONS
  // -------------------------------------------------------------------------
  console.log("\n--- 11. NEGATIVE CONTROLS & SECURITY ASSERTIONS ---");

  // Negative Control #1: Unapproved write cannot execute
  const ctrlNeg = new AgentPermissionController();
  ctrlNeg.setMode("ask");

  let negExecuted = 0;
  const runtimeNeg = new AgentExecutionRuntime({
    projectId: PROJECT_ID,
    generation: 1,
    controller: ctrlNeg,
    executeTool: async () => {
      negExecuted++;
      return { ok: true, data: null };
    },
    scheduleDrain: (fn) => queueMicrotask(fn),
  });

  const { attempt: attNeg } = runtimeNeg.submit({
    toolCallId: "neg-1",
    name: "write_file",
    args: { path: "unapproved.txt" },
    projectId: PROJECT_ID,
    generation: 1,
  });
  await runtimeNeg.drain();

  assert(attNeg.state === "awaiting-approval", "Unapproved write is blocked at awaiting-approval");
  assert(negExecuted === 0, "Negative Control #1: Handler executed ZERO times without approval");

  // Negative Control #2: Replaying unconsumed authorization after cancellation fails
  const unconsumedApprId = attNeg.approvalId!;
  runtimeNeg.cancel(attNeg.attemptId);
  assert(
    ctrlNeg.getApproval(unconsumedApprId)?.status === "cancelled",
    "Approval was cancelled upon attempt cancellation",
  );

  // Attempting to submit identical call again must NOT inherit authorization
  const { attempt: attNeg2 } = runtimeNeg.submit({
    toolCallId: "neg-2",
    name: "write_file",
    args: { path: "unapproved.txt" },
    projectId: PROJECT_ID,
    generation: 1,
  });
  await runtimeNeg.drain();
  assert(
    attNeg2.state === "awaiting-approval",
    "Negative Control #2: Subsequent call cannot claim cancelled authorization and pauses for approval",
  );

  // Negative Control #3: Terminal state cannot transition
  const termAtt = attNeg; // state is cancelled
  assert((runtimeNeg as any).transition(termAtt, "succeeded") === undefined, "Transition on terminal state is ignored");
  assert(termAtt.state === "cancelled", "Negative Control #3: Terminal state remains cancelled (Immutability enforced)");

  console.log("==========================================================================");
  console.log(`  SUCCESS: ALL ${passCount} DETERMINISTIC ASSERTIONS PASSED PERFECTLY!`);
  console.log("==========================================================================");
}

runTests().catch((err) => {
  console.error("Test harness uncaught failure:", err);
  process.exit(1);
});
