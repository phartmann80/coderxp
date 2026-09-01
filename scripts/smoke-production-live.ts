import assert from "node:assert";
import WebSocket from "ws";

async function main() {
  console.log("==========================================================================");
  console.log("          CODERXP PRODUCTION POST-DEPLOYMENT LIVE SMOKE GATE             ");
  console.log("==========================================================================\n");

  const baseUrl = process.env.LIVE_TARGET_URL || "https://coderxp.pro";
  const user = process.env.AUTH_ADMIN_EMAIL || "paul@coderxp.pro";
  const pass = process.env.AUTH_ADMIN_PASSWORD || "coderxp-pilot-2026";

  console.log(`Target: ${baseUrl}\n`);

  // Check 0: Open UI Gating (No Basic Auth Prompt, HTTP 200)
  console.log("--- 0. Checking Open UI (No Basic Auth prompt, HTTP 200) ---");
  const uiRes = await fetch(`${baseUrl}/workspace`);
  assert.strictEqual(uiRes.status, 200, `Workspace UI must return HTTP 200 without Basic Auth (got ${uiRes.status})`);
  assert(!uiRes.headers.get("www-authenticate"), "WWW-Authenticate header must not be present");
  console.log("[PASS] /workspace serves HTTP 200 with zero Basic Auth prompts.");

  // Check 1: Unauthenticated Fail-Closed Protection on API Endpoints
  console.log("\n--- 1. Checking Unauthenticated API Fail-Closed (Must Return 401) ---");
  const unauthStream = await fetch(`${baseUrl}/api/agent/stream`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages: [{ role: "user", content: "hi" }] }),
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
    body: JSON.stringify({ identifier: user, password: pass }),
  });
  assert.strictEqual(loginRes.status, 200, `Login failed with HTTP ${loginRes.status}`);
  const loginJson: any = await loginRes.json();
  assert.strictEqual(loginJson.ok, true, "Login ok field must be true");
  const sessionToken = loginJson.token;
  assert(sessionToken, "Session token must be returned from login");

  const setCookie = loginRes.headers.get("set-cookie") || "";
  const cookieHeader = setCookie ? setCookie.split(";")[0] : `coderxp_session=${sessionToken}`;
  const authHeaders: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${sessionToken}`,
    Cookie: cookieHeader,
  };
  console.log("[PASS] App-level authentication succeeded. Session cookie acquired.");

  // Check 3: Authenticated Agent Health Check
  console.log("\n--- 3. Checking Authenticated /api/agent/health ---");
  const healthRes = await fetch(`${baseUrl}/api/agent/health`, { headers: authHeaders });
  assert.strictEqual(healthRes.status, 200, `Health check failed with HTTP ${healthRes.status}`);
  const healthJson: any = await healthRes.json();
  assert.strictEqual(healthJson.ok, true, "Health response ok field must be true");
  assert.strictEqual(healthJson.ready, true, "Provider must be ready");
  console.log(`[PASS] Authenticated health check passed (${healthJson.providerId}, model: ${healthJson.defaultModelDisplayName}).`);

  // Check 4: Authenticated Live Agent Stream Turn (/api/agent/stream)
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

  const reader = streamRes.body?.getReader();
  assert(reader, "Stream body must be readable");

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

  // Check 5: Authenticated Devbox WSS Token & Full Duplex Roundtrip
  console.log("\n--- 5. Checking Devbox WSS Token & Stdin/Stdout Roundtrip ---");
  const marker = `E2E_MARKER_${Math.random().toString(36).substring(2, 10)}`;
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
    const timeout = setTimeout(() => reject(new Error("Devbox WSS connection timeout")), 15000);
    const ws = new WebSocket(wsUrl);

    let handshakeReceived = false;
    let markerReceived = false;

    ws.on("open", () => {
      // connected
    });

    ws.on("message", (raw: any) => {
      try {
        const str = raw.toString();
        const parsed = JSON.parse(str);

        if (parsed.type === "handshake_ack") {
          handshakeReceived = true;
          ws.send(JSON.stringify({ type: "command", command: "echo", args: [marker] }));
        }

        if (parsed.type === "output" && typeof parsed.data === "string") {
          if (parsed.data.includes(marker)) {
            markerReceived = true;
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

    ws.on("close", () => {
      if (!markerReceived && !handshakeReceived) {
        clearTimeout(timeout);
        reject(new Error("WebSocket closed before handshake or marker reception"));
      }
    });
  });

  console.log(`[PASS] Devbox WebSocket full-duplex verified. Server echoed ${marker} successfully.`);

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
