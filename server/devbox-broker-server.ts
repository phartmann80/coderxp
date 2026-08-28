/**
 * Standalone Devbox PTY Broker Server for CoderXP Revision 2.4.
 *
 * Runs as a host daemon on 127.0.0.1:3200 (proxied via Nginx over WSS).
 * Authenticates handshakes with single-use HMAC tokens and streams redacted PTY.
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
    res.end(JSON.stringify({ ok: true, service: "devbox-pty-broker", host: HOST, port: PORT }));
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

    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit("connection", ws, req, { userId: authResult.userId, projectId });
    });
  } catch {
    socket.write("HTTP/1.1 400 Bad Request\r\n\r\n");
    socket.destroy();
  }
});

wss.on("connection", (ws: WebSocket, req, context: { userId: string; projectId: string }) => {
  const redactor = new StreamingRedactor();

  // Send initial connected banner
  const banner = `\x1b[1;34m[CoderXP Devbox Broker Connected]\x1b[0m Project: ${context.projectId}\r\n`;
  ws.send(banner);

  ws.on("message", async (data) => {
    const raw = data.toString("utf8");
    try {
      const msg = JSON.parse(raw);
      if (msg.type === "input") {
        // Execute input in devbox session
        const execRes = await devboxBroker.executeCommand(
          context.projectId,
          msg.command,
          msg.args || [],
          { initiatedBy: "user" }
        );
        const redacted = redactor.processChunk(execRes.output) + redactor.flush();
        ws.send(JSON.stringify({ type: "output", data: redacted }));
      }
    } catch {
      // Raw terminal keypress input
      const sanitized = redactor.processChunk(raw) + redactor.flush();
      ws.send(sanitized);
    }
  });

  ws.on("close", () => {
    // client disconnected
  });
});

server.listen(PORT, HOST, () => {
  console.log(`[DevboxBroker] Listening exclusively on http://${HOST}:${PORT}`);
});
