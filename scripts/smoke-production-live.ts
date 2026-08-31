import assert from "node:assert";

async function main() {
  console.log("==========================================================================");
  console.log("          CODERXP PRODUCTION POST-DEPLOYMENT LIVE SMOKE GATE             ");
  console.log("==========================================================================\n");

  const baseUrl = process.env.LIVE_TARGET_URL || "https://coderxp.pro";
  const authHeader = "Basic " + Buffer.from("coderxpadmin:coderxp-devbox-2026-auth").toString("base64");
  const headers = { Authorization: authHeader, "Content-Type": "application/json" };

  console.log(`Target: ${baseUrl}\n`);

  // Check 1: Health Endpoint
  console.log("--- 1. Checking /api/agent/health ---");
  const healthRes = await fetch(`${baseUrl}/api/agent/health`, { headers });
  assert.strictEqual(healthRes.status, 200, `Health check failed with HTTP ${healthRes.status}`);
  const healthJson: any = await healthRes.json();
  assert.strictEqual(healthJson.ok, true, "Health response ok field must be true");
  assert.strictEqual(healthJson.ready, true, "Provider must be ready");
  console.log(`[PASS] Health check passed (${healthJson.providerId}, model: ${healthJson.defaultModelDisplayName}).`);

  // Check 2: Live Agent Streaming Request
  console.log("\n--- 2. Checking Real Stream Turn (/api/agent/stream) ---");
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
    headers,
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
          // ignore parsing non-json
        }
      }
    }
  }

  assert(receivedText.length > 0, "Streamed text must not be empty");
  assert(turnCompleted, "Turn must complete cleanly");
  console.log(`[PASS] Stream completed successfully. Received: "${receivedText.trim()}"`);

  // Check 3: Devbox WSS Token & Full Duplex Stdin/Stdout Roundtrip
  console.log("\n--- 3. Checking Devbox WSS Stdin/Stdout Roundtrip ---");
  const marker = `E2E_MARKER_${Math.random().toString(36).substring(2, 10)}`;
  const tokenRes = await fetch(`${baseUrl}/api/devbox/token`, {
    method: "POST",
    headers,
    body: JSON.stringify({ projectId: "smoke-project" }),
  });
  assert.strictEqual(tokenRes.status, 200, `Token generation failed with HTTP ${tokenRes.status}`);
  const tokenData: any = await tokenRes.json();
  const token = tokenData.token;
  assert(token, "Token must be present in response");

  const wsUrl = `wss://coderxp.pro/ws/devbox/?token=${encodeURIComponent(token)}&projectId=smoke-project`;
  console.log("Connecting to Devbox WebSocket broker...");

  // Use global WebSocket available in Node.js 22+
  const NativeWs = (globalThis as any).WebSocket;
  assert(NativeWs, "Global WebSocket must be available in runtime");

  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Devbox WSS connection timeout")), 15000);
    const ws = new NativeWs(wsUrl, { headers: { Authorization: authHeader } });

    let handshakeReceived = false;
    let markerReceived = false;

    ws.onopen = () => {
      // open
    };

    ws.onmessage = (event: any) => {
      try {
        const str = typeof event.data === "string" ? event.data : event.data.toString();
        const parsed = JSON.parse(str);

        if (parsed.type === "handshake_ack") {
          handshakeReceived = true;
          // Send echo command with unique marker to verify stdin dispatch
          ws.send(JSON.stringify({ type: "command", command: "echo", args: [marker] }));
        }

        if (parsed.type === "output" && typeof parsed.data === "string") {
          if (parsed.data.includes(marker)) {
            markerReceived = true;
            clearTimeout(timeout);
            ws.close();
            resolve();
          }
        }
      } catch {
        // ignore
      }
    };

    ws.onerror = (err: any) => {
      clearTimeout(timeout);
      reject(err);
    };

    ws.onclose = () => {
      if (!markerReceived && !handshakeReceived) {
        clearTimeout(timeout);
        reject(new Error("WebSocket closed before handshake or marker reception"));
      }
    };
  });

  console.log(`[PASS] Devbox WebSocket full-duplex verified. Server echoed ${marker} successfully.`);

  // Check 4: Activity Timeline & Events API
  console.log("\n--- 4. Checking Devbox Timeline & Host Events API ---");
  const eventsRes = await fetch(`${baseUrl}/api/devbox/events?projectId=smoke-project`, { headers });
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
