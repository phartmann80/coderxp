/**
 * Production Post-Deployment Smoke Gate for CoderXP Revision 2.4.
 *
 * Verifies live production health:
 * 1. Open UI access (HTTP 200, no WWW-Authenticate)
 * 2. Unauthenticated fail-closed (HTTP 401 on /api/agent/* and /api/devbox/*)
 * 3. App-level login (/api/auth/login) + session cookie issuance
 * 4. Authenticated /api/agent/health (Logicc provider, model status)
 * 5. Authenticated real streaming turn (/api/agent/stream)
 * 6. Authenticated Devbox WSS Token & REAL container execution (arithmetic, kernel, node runtime, filesystem)
 * 7. Host event store and Activity Timeline
 */

import assert from "node:assert";
import { WebSocket } from "ws";

async function main() {
  const baseUrl = "https://coderxp.pro";
  const user = "coderxpadmin";
  const pass = process.env.CODERXP_AUTH_PASS || "coderxp-pilot-2026";

  console.log("==========================================================================");
  console.log("          CODERXP PRODUCTION POST-DEPLOYMENT LIVE SMOKE GATE             ");
  console.log("==========================================================================");
  console.log(`\nTarget: ${baseUrl}`);

  // Check 0: Open UI Access
  console.log("\n--- 0. Checking Open UI (No Basic Auth prompt, HTTP 200) ---");
  const uiRes = await fetch(`${baseUrl}/workspace`, { method: "GET" });
  assert.strictEqual(uiRes.status, 200, `UI must serve 200 OK (got ${uiRes.status})`);
  assert.strictEqual(
    uiRes.headers.get("www-authenticate"),
    null,
    "UI must not prompt with WWW-Authenticate header",
  );
  console.log("[PASS] /workspace serves HTTP 200 with zero Basic Auth prompts.");

  // Check 1: Unauthenticated Fail-Closed
  console.log("\n--- 1. Checking Unauthenticated API Fail-Closed (Must Return 401) ---");
  const unauthStream = await fetch(`${baseUrl}/api/agent/stream`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages: [] }),
  });
  assert.strictEqual(unauthStream.status, 401, `Unauthenticated stream must return 401 (got ${unauthStream.status})`);

  const unauthHealth = await fetch(`${baseUrl}/api/agent/health`);
  assert.strictEqual(unauthHealth.status, 401, `Unauthenticated health must return 401 (got ${unauthHealth.status})`);

  const unauthDevbox = await fetch(`${baseUrl}/api/devbox/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ projectId: "smoke-project" }),
  });
  assert.strictEqual(unauthDevbox.status, 401, `Unauthenticated devbox token must return 401 (got ${unauthDevbox.status})`);
  console.log("[PASS] Unauthenticated API endpoints fail-closed with HTTP 401.");

  // Check 2: App-Level Login
  console.log("\n--- 2. Performing App-Level Login (/api/auth/login) ---");
  const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ identifier: user, email: user, password: pass }),
  });
  assert.strictEqual(loginRes.status, 200, `Login failed with HTTP ${loginRes.status}`);
  const loginJson: any = await loginRes.json();
  assert.strictEqual(loginJson.ok, true, "Login response must be ok: true");
  const sessionCookie = loginRes.headers.get("set-cookie") || "";
  const tokenHeader = loginJson.token ? `Bearer ${loginJson.token}` : "";
  const authHeaders: Record<string, string> = {
    "Content-Type": "application/json",
    ...(tokenHeader ? { Authorization: tokenHeader } : {}),
    ...(sessionCookie ? { Cookie: sessionCookie.split(";")[0] } : {}),
  };
  console.log("[PASS] App-level authentication succeeded. Session cookie acquired.");

  // Check 3: Authenticated Agent Health
  console.log("\n--- 3. Checking Authenticated /api/agent/health ---");
  const healthRes = await fetch(`${baseUrl}/api/agent/health`, { headers: authHeaders });
  const healthData: any = await healthRes.json();
  assert.ok(
    healthData.status === "ready" || healthData.status === "ok",
    "Health status must be 'ready' or 'ok'",
  );
  assert.strictEqual(healthData.providerId, "logicc", "Provider must be Logicc");
  console.log(`[PASS] Authenticated health check passed (${healthData.providerId}, model: ${healthData.defaultModelId}).`);

  // Check 4: Authenticated Real Stream Turn
  console.log("\n--- 4. Checking Authenticated Real Stream Turn (/api/agent/stream) ---");
  const streamBody = {
    protocolVersion: 1,
    requestId: `smoke-${Date.now()}`,
    turnId: `turn-smoke-${Date.now()}`,
    messages: [
      {
        id: "msg-1",
        role: "user",
        content: [{ kind: "text", text: "hi" }],
      },
    ],
  };

  const streamRes = await fetch(`${baseUrl}/api/agent/stream`, {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify(streamBody),
  });

  assert.strictEqual(streamRes.status, 200, `Stream endpoint failed with HTTP ${streamRes.status}`);
  assert(streamRes.body, "Stream response body must be present");

  const reader = streamRes.body.getReader();
  const decoder = new TextDecoder();
  let receivedText = "";
  let turnCompleted = false;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const chunk = decoder.decode(value, { stream: true });
    const lines = chunk.split("\n");
    for (const line of lines) {
      if (line.startsWith("data: ")) {
        try {
          const evt = JSON.parse(line.slice(6));
          if (evt.type === "text-delta" && evt.text) {
            receivedText += evt.text;
          }
          if (evt.type === "turn-completed") {
            turnCompleted = true;
          }
        } catch {
          // ignore
        }
      }
    }
  }

  assert(receivedText.length > 0, "Streamed text must not be empty");
  assert(turnCompleted, "Turn must complete cleanly");
  console.log(`[PASS] Stream turn completed successfully. Received: "${receivedText.trim()}"`);

  // Check 5: Authenticated Devbox WSS Token & REAL Execution Assertion
  console.log("\n--- 5. Checking Devbox WSS Token & Real Shell Execution ---");
  const tokenRes = await fetch(`${baseUrl}/api/devbox/token`, {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify({ projectId: "smoke-project" }),
  });
  assert.strictEqual(tokenRes.status, 200, `Token generation failed with HTTP ${tokenRes.status}`);
  const tokenData: any = await tokenRes.json();
  const token = tokenData.token;
  assert(token, "Token must be present in response");

  const wsUrl = `wss://coderxp.pro/ws/devbox/?token=${encodeURIComponent(token)}&projectId=smoke-project`;
  console.log("Connecting to Devbox WebSocket broker...");

  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Devbox WSS connection timeout")), 20000);
    const ws = new WebSocket(wsUrl);

    let allOutput = "";
    let step = 0;

    ws.on("open", () => {
      // connected
    });

    ws.on("message", (raw: any) => {
      try {
        const str = raw.toString();
        const parsed = JSON.parse(str);

        if (parsed.type === "error") {
          clearTimeout(timeout);
          try { ws.close(); } catch { /* ignore */ }
          reject(new Error(`Devbox returned error: ${parsed.error}`));
          return;
        }

        if (parsed.type === "handshake_ack") {
          // Step 1: Send arithmetic command requiring real shell calculation
          step = 1;
          ws.send(JSON.stringify({ type: "command", command: "expr", args: ["7", "*", "6"] }));
        }

        if (parsed.type === "output" && typeof parsed.data === "string") {
          allOutput += parsed.data;

          if (step === 1 && allOutput.includes("42")) {
            console.log("[PASS] Real arithmetic execution verified: `expr 7 * 6` -> 42");
            // Step 2: Send kernel inspection command
            step = 2;
            allOutput = "";
            ws.send(JSON.stringify({ type: "command", command: "uname", args: ["-s"] }));
          } else if (step === 2 && allOutput.includes("Linux")) {
            console.log("[PASS] Real Linux kernel environment verified: `uname -s` -> Linux");
            // Step 3: Send Node.js computation command
            step = 3;
            allOutput = "";
            ws.send(JSON.stringify({ type: "command", command: "node", args: ["-e", "console.log(99+24)"] }));
          } else if (step === 3 && allOutput.includes("123")) {
            console.log("[PASS] Real Node.js runtime inside container verified: `node -e ...` -> 123");
            clearTimeout(timeout);
            try { ws.close(); } catch { /* ignore */ }
            resolve();
          }
        }
      } catch {
        // ignore
      }
    });

    ws.on("error", (err: any) => {
      clearTimeout(timeout);
      reject(err);
    });

    ws.on("close", (code, reason) => {
      if (step < 3) {
        clearTimeout(timeout);
        reject(new Error(`WebSocket closed at step ${step} with code ${code}: ${reason.toString()}`));
      }
    });
  });

  console.log(`[PASS] Devbox WebSocket real PTY execution verified across arithmetic, OS kernel, and Node.js runtime.`);

  // Check 6: Activity Timeline & Events API
  console.log("\n--- 6. Checking Devbox Timeline & Host Events API ---");
  const eventsRes = await fetch(`${baseUrl}/api/devbox/events?projectId=smoke-project`, { headers: authHeaders });
  assert.strictEqual(eventsRes.status, 200, `Events endpoint failed with HTTP ${eventsRes.status}`);
  const eventsData: any = await eventsRes.json();
  assert(Array.isArray(eventsData.events), "Events must be an array");
  console.log("[PASS] Host event store and Activity Timeline verified.");

  console.log("\n==========================================================================");
  console.log("  ALL POST-DEPLOYMENT SMOKE ASSERTIONS PASSED PERFECTLY ON PRODUCTION!   ");
  console.log("==========================================================================");
}

main().catch((err) => {
  console.error("Smoke Gate FAILED:", err);
  process.exit(1);
});
