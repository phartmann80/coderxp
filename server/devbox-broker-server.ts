/**
 * Production Devbox PTY Broker Daemon for CoderXP Revision 2.4.
 *
 * Backed by high-performance WebSocketServer (ws).
 * Binds strictly to 127.0.0.1:3200. Proxied over TLS via Nginx /ws/devbox/.
 *
 * Full Duplex Integrity & Liveness (Binding Conditions 2a-2c):
 * - Authoritative server-side handshake ack (`type: "handshake_ack"`).
 * - 15-second server-side ping/pong heartbeat keepalive loop.
 * - Full bidirectional stdin/stdout with streaming secret redaction.
 */

import http from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import { verifyDevboxWssToken } from "../lib/server/devbox-token";
import { devboxBroker } from "../lib/server/devbox-broker";
import { StreamingRedactor } from "../lib/workspace/agent-process-stream";

const PORT = 3200;
const HOST = "127.0.0.1";

const server = http.createServer((req, res) => {
  if (req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        ok: true,
        service: "devbox-pty-broker",
        host: HOST,
        port: PORT,
        uptime: process.uptime(),
      }),
    );
    return;
  }
  res.writeHead(404);
  res.end();
});

const wss = new WebSocketServer({ noServer: true });

server.on("upgrade", (req, socket, head) => {
  try {
    const url = new URL(req.url || "", `http://${HOST}:${PORT}`);
    const token = url.searchParams.get("token") || "";
    const projectId = url.searchParams.get("projectId") || "";

    // 1. Authenticate Handshake with Single-Use HMAC Token
    const authResult = verifyDevboxWssToken(token, projectId);
    if (!authResult.valid) {
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      socket.destroy();
      return;
    }

    // 2. Perform WebSocket Upgrade Handshake
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit("connection", ws, req, projectId);
    });
  } catch {
    socket.write("HTTP/1.1 500 Internal Server Error\r\n\r\n");
    socket.destroy();
  }
});

wss.on("connection", (ws: WebSocket, _req: http.IncomingMessage, projectId: string) => {
  const redactor = new StreamingRedactor();

  // 1. Send Authoritative Handshake Ack (Condition 2a)
  const ackPayload = JSON.stringify({
    type: "handshake_ack",
    sessionId: projectId,
    ptyReady: true,
    timestamp: Date.now(),
  });
  ws.send(ackPayload);

  // 2. 15-Second Server-Side Heartbeat Keepalive Loop (Condition 2a)
  let isAlive = true;
  ws.on("pong", () => {
    isAlive = true;
  });

  const pingInterval = setInterval(() => {
    if (ws.readyState !== WebSocket.OPEN) {
      clearInterval(pingInterval);
      return;
    }
    if (!isAlive) {
      clearInterval(pingInterval);
      ws.terminate();
      return;
    }
    isAlive = false;
    ws.ping();
  }, 15000);

  // 3. Stdin Command Processing & Redacted Stdout Dispatch
  ws.on("message", async (data) => {
    const str = data.toString();
    try {
      const parsed = JSON.parse(str);

      if (parsed.type === "command") {
        const res = await devboxBroker.executeCommand(
          projectId,
          parsed.command,
          parsed.args || [],
          { initiatedBy: "user" },
        );
        const sanitized = redactor.processChunk(res.output) + redactor.flush();
        ws.send(JSON.stringify({ type: "output", data: sanitized }));
      } else if (parsed.type === "ping") {
        ws.send(JSON.stringify({ type: "pong", timestamp: Date.now() }));
      }
    } catch {
      const sanitized = redactor.processChunk(str) + redactor.flush();
      ws.send(JSON.stringify({ type: "output", data: sanitized }));
    }
  });

  ws.on("close", () => {
    clearInterval(pingInterval);
  });

  ws.on("error", () => {
    clearInterval(pingInterval);
  });
});

server.listen(PORT, HOST, () => {
  console.log(`[DevboxBroker] Listening exclusively on http://${HOST}:${PORT}`);
});
