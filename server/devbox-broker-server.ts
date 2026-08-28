/**
 * Zero-Dependency Devbox PTY Broker Daemon for CoderXP Revision 2.4.
 *
 * Built strictly with Node.js built-ins (node:http, node:crypto) — no external packages.
 * Binds strictly to 127.0.0.1:3200. Proxied over TLS via Nginx /ws/devbox/.
 */

import http from "node:http";
import crypto from "node:crypto";
import { verifyDevboxWssToken } from "../lib/server/devbox-token";
import { devboxBroker } from "../lib/server/devbox-broker";
import { StreamingRedactor } from "../lib/workspace/agent-process-stream";

const PORT = 3200;
const HOST = "127.0.0.1";
const WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

function encodeWsFrame(payload: string): Buffer {
  const payloadBuf = Buffer.from(payload, "utf8");
  const len = payloadBuf.length;

  if (len < 126) {
    return Buffer.concat([Buffer.from([0x81, len]), payloadBuf]);
  } else if (len < 65536) {
    const header = Buffer.alloc(4);
    header[0] = 0x81;
    header[1] = 126;
    header.writeUInt16BE(len, 2);
    return Buffer.concat([header, payloadBuf]);
  } else {
    const header = Buffer.alloc(10);
    header[0] = 0x81;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(len), 2);
    return Buffer.concat([header, payloadBuf]);
  }
}

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

server.on("upgrade", (req, socket) => {
  try {
    const url = new URL(req.url || "", `http://${HOST}:${PORT}`);
    const token = url.searchParams.get("token") || "";
    const projectId = url.searchParams.get("projectId") || "";
    const key = req.headers["sec-websocket-key"];

    if (!key) {
      socket.write("HTTP/1.1 400 Bad Request\r\n\r\n");
      socket.destroy();
      return;
    }

    // 1. Authenticate Handshake with Single-Use HMAC Token
    const authResult = verifyDevboxWssToken(token, projectId);
    if (!authResult.valid) {
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      socket.destroy();
      return;
    }

    // 2. Perform WebSocket Upgrade Handshake
    const accept = crypto.createHash("sha1").update(key + WS_GUID).digest("base64");
    socket.write(
      "HTTP/1.1 101 Switching Protocols\r\n" +
        "Upgrade: websocket\r\n" +
        "Connection: Upgrade\r\n" +
        `Sec-WebSocket-Accept: ${accept}\r\n\r\n`,
    );

    const redactor = new StreamingRedactor();
    const banner = `\x1b[1;34m[CoderXP Devbox Broker Connected]\x1b[0m Project: ${projectId}\r\n`;
    socket.write(encodeWsFrame(banner));

    socket.on("data", async (chunk) => {
      if (chunk.length < 2) return;
      const secondByte = chunk[1];
      const isMasked = (secondByte & 0x80) !== 0;
      let payloadLength = secondByte & 0x7f;
      let offset = 2;

      if (payloadLength === 126) {
        payloadLength = chunk.readUInt16BE(2);
        offset = 4;
      } else if (payloadLength === 127) {
        payloadLength = Number(chunk.readBigUInt64BE(2));
        offset = 10;
      }

      let payload: Buffer;
      if (isMasked) {
        const mask = chunk.slice(offset, offset + 4);
        offset += 4;
        const maskedData = chunk.slice(offset, offset + payloadLength);
        payload = Buffer.alloc(maskedData.length);
        for (let i = 0; i < maskedData.length; i++) {
          payload[i] = maskedData[i] ^ mask[i % 4];
        }
      } else {
        payload = chunk.slice(offset, offset + payloadLength);
      }

      const text = payload.toString("utf8");
      try {
        const parsed = JSON.parse(text);
        if (parsed.type === "command") {
          const res = await devboxBroker.executeCommand(
            projectId,
            parsed.command,
            parsed.args || [],
            { initiatedBy: "user" },
          );
          const sanitized = redactor.processChunk(res.output) + redactor.flush();
          socket.write(encodeWsFrame(JSON.stringify({ type: "output", data: sanitized })));
        }
      } catch {
        const sanitized = redactor.processChunk(text) + redactor.flush();
        socket.write(encodeWsFrame(sanitized));
      }
    });

    socket.on("close", () => {
      // Disconnected
    });
  } catch {
    socket.write("HTTP/1.1 500 Internal Server Error\r\n\r\n");
    socket.destroy();
  }
});

server.listen(PORT, HOST, () => {
  console.log(`[DevboxBroker] Listening exclusively on http://${HOST}:${PORT}`);
});
