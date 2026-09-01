/**
 * Production Devbox PTY Broker Daemon for CoderXP Revision 2.4.
 *
 * Backed by high-performance WebSocketServer (ws) and real Docker Devbox containers.
 * Binds strictly to 127.0.0.1:3200. Proxied over TLS via Nginx /ws/devbox/.
 *
 * Full Duplex Integrity & Real Container Attachment:
 * - Authoritative server-side handshake ack (`type: "handshake_ack"`).
 * - Real Docker container attachment via interactive `/bin/bash -l` process.
 * - 15-second server-side ping/pong heartbeat keepalive loop.
 * - Bidirectional streaming stdin/stdout with streaming secret redaction.
 * - Fail-closed: true Docker errors surfaced directly to the terminal, zero synthetic output.
 */

import http from "node:http";
import { spawn, type ChildProcess } from "node:child_process";
import { WebSocketServer, WebSocket } from "ws";
import { verifyDevboxWssToken } from "../lib/server/devbox-token";
import { devboxBroker, ensureDockerDevbox } from "../lib/server/devbox-broker";
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

wss.on("connection", async (ws: WebSocket, _req: http.IncomingMessage, projectId: string) => {
  const redactor = new StreamingRedactor();
  const containerName = `coderxp-devbox-${projectId}`;
  const volumeName = `coderxp-vol-${projectId}`;

  // 1. Ensure devbox container is created and running on the host
  await devboxBroker.getOrCreateDevbox(projectId, "coderxpadmin");
  const dockerCheck = await ensureDockerDevbox(containerName, volumeName);

  if (!dockerCheck.ok) {
    ws.send(
      JSON.stringify({
        type: "error",
        error: `Could not attach to devbox container: ${dockerCheck.error}`,
      }),
    );
    ws.close(1011, "Container attachment failed");
    return;
  }

  // 2. Spawn real interactive shell inside the Docker Devbox container
  let ptyProcess: ChildProcess | null = null;
  try {
    ptyProcess = spawn("docker", ["exec", "-i", containerName, "/bin/bash", "-l"], {
      stdio: ["pipe", "pipe", "pipe"],
      env: {
        ...process.env,
        TERM: "xterm-256color",
      },
    });
  } catch (err: any) {
    ws.send(
      JSON.stringify({
        type: "error",
        error: `Failed to spawn shell process in devbox: ${err.message}`,
      }),
    );
    ws.close(1011, "Shell spawn failed");
    return;
  }

  // 3. Send Authoritative Handshake Ack
  const ackPayload = JSON.stringify({
    type: "handshake_ack",
    sessionId: projectId,
    ptyReady: true,
    timestamp: Date.now(),
  });
  ws.send(ackPayload);

  // 4. Pipe PTY stdout and stderr to WebSocket with real-time redaction
  ptyProcess.stdout?.on("data", (chunk: Buffer) => {
    const raw = chunk.toString("utf8");
    const sanitized = redactor.processChunk(raw);
    if (ws.readyState === WebSocket.OPEN && sanitized) {
      ws.send(JSON.stringify({ type: "output", data: sanitized }));
    }
  });

  ptyProcess.stderr?.on("data", (chunk: Buffer) => {
    const raw = chunk.toString("utf8");
    const sanitized = redactor.processChunk(raw);
    if (ws.readyState === WebSocket.OPEN && sanitized) {
      ws.send(JSON.stringify({ type: "output", data: sanitized }));
    }
  });

  ptyProcess.on("error", (err) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(
        JSON.stringify({
          type: "error",
          error: `Devbox execution error: ${err.message}`,
        }),
      );
    }
  });

  ptyProcess.on("close", (code) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(
        JSON.stringify({
          type: "output",
          data: `\r\n[Devbox session disconnected (exit code ${code})]\r\n`,
        }),
      );
    }
  });

  // 5. 15-Second Server-Side Heartbeat Keepalive Loop
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

  // 6. Handle Incoming Stdin / Commands from xterm.js or Agent
  ws.on("message", (data) => {
    const str = data.toString();
    try {
      if (str.startsWith("{") && str.endsWith("}")) {
        const parsed = JSON.parse(str);
        if (parsed.type === "command") {
          const cmd = `${parsed.command} ${(parsed.args || []).join(" ")}\n`;
          ptyProcess?.stdin?.write(cmd);
          return;
        }
        if (parsed.type === "stdin" && typeof parsed.data === "string") {
          ptyProcess?.stdin?.write(parsed.data);
          return;
        }
        if (parsed.type === "ping") {
          ws.send(JSON.stringify({ type: "pong", timestamp: Date.now() }));
          return;
        }
        if (parsed.type === "resize") {
          // Window resize event (if supported)
          return;
        }
      }
      // Raw terminal keystroke data from xterm.js onData
      ptyProcess?.stdin?.write(str);
    } catch {
      ptyProcess?.stdin?.write(str);
    }
  });

  ws.on("close", () => {
    clearInterval(pingInterval);
    if (ptyProcess) {
      try {
        ptyProcess.kill();
      } catch {
        /* ignore */
      }
    }
  });

  ws.on("error", () => {
    clearInterval(pingInterval);
    if (ptyProcess) {
      try {
        ptyProcess.kill();
      } catch {
        /* ignore */
      }
    }
  });
});

server.listen(PORT, HOST, () => {
  console.log(`[DevboxBroker] Listening exclusively on http://${HOST}:${PORT}`);
});
