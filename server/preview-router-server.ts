#!/usr/bin/env tsx
/**
 * CoderXP Preview Router (port 3400)
 *
 * Receives requests from Nginx for *.preview.coderxp.pro.
 * Reads X-Preview-Slug header (or Host header), resolves slug -> container IP & port via Next.js API,
 * and reverse-proxies HTTP and WebSocket (HMR) to the devbox container.
 *
 * Deployed as: /opt/coderxp/source/server/preview-router-server.ts
 * Managed by:  coderxp-preview.service
 */

import http from "node:http";
import net from "node:net";
import { execSync } from "node:child_process";

const ROUTER_PORT = parseInt(process.env.PREVIEW_ROUTER_PORT ?? "3400", 10);
const PREVIEW_API_BASE = process.env.PREVIEW_API_BASE ?? "http://127.0.0.1:3100";

interface SlugResult {
  ok: boolean;
  slug?: string;
  projectId?: string;
  containerPort?: number;
  error?: string;
}

const containerIpCache = new Map<string, { ip: string; expires: number }>();

function getContainerIp(projectId: string): string {
  const cached = containerIpCache.get(projectId);
  if (cached && Date.now() < cached.expires) {
    return cached.ip;
  }
  try {
    const cmd = `docker inspect coderxp-devbox-${projectId} -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}'`;
    const ip = execSync(cmd, { encoding: "utf8", timeout: 3000 }).trim();
    if (ip) {
      containerIpCache.set(projectId, { ip, expires: Date.now() + 10000 });
      return ip;
    }
  } catch {
    // ignore
  }
  return "127.0.0.1";
}

async function resolveSlug(slug: string): Promise<SlugResult> {
  try {
    const res = await fetch(
      `${PREVIEW_API_BASE}/api/preview/resolve?slug=${encodeURIComponent(slug)}`,
    );
    const json = (await res.json()) as SlugResult;
    return json;
  } catch (err: any) {
    return { ok: false, error: String(err?.message ?? "resolve failed") };
  }
}

function extractSlug(req: http.IncomingMessage): string {
  const fromHeader = req.headers["x-preview-slug"];
  if (typeof fromHeader === "string" && fromHeader.length > 0) {
    return fromHeader;
  }
  const host = req.headers["host"] ?? "";
  const match = host.match(/^([^.]+)\.preview\.coderxp\.pro/);
  return match ? match[1] : "";
}

const server = http.createServer(async (req, res) => {
  const slug = extractSlug(req);

  if (!slug) {
    res.writeHead(400, { "Content-Type": "text/plain" });
    res.end("Missing preview slug");
    return;
  }

  const result = await resolveSlug(slug);
  if (!result.ok) {
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end(`Preview not found or link revoked: ${result.error ?? "unknown slug"}\n`);
    return;
  }

  const targetHost = result.projectId ? getContainerIp(result.projectId) : "127.0.0.1";
  const targetPort = result.containerPort || 3000;

  const proxyReq = http.request(
    {
      hostname: targetHost,
      port: targetPort,
      path: req.url,
      method: req.method,
      headers: {
        ...req.headers,
        host: `localhost:${targetPort}`,
      },
    },
    (proxyRes) => {
      // Cookie isolation: strip Set-Cookie on preview responses
      const hdrs = Object.fromEntries(
        Object.entries(proxyRes.headers).filter(([k]) => k.toLowerCase() !== "set-cookie"),
      );
      res.writeHead(proxyRes.statusCode ?? 200, hdrs);
      proxyRes.pipe(res, { end: true });
    },
  );

  proxyReq.on("error", (err: any) => {
    if (!res.headersSent) {
      res.writeHead(502, { "Content-Type": "text/plain" });
      res.end(
        `[CoderXP Live Preview] Devbox server not reachable on ${targetHost}:${targetPort} (${err.code || err.message}).\nEnsure your app is running with PORT=3000 inside the devbox container.\n`,
      );
    }
  });

  req.pipe(proxyReq, { end: true });
});

// WebSocket / HMR upgrade handling
server.on("upgrade", async (req, socket, head) => {
  const slug = extractSlug(req);
  if (!slug) {
    socket.destroy();
    return;
  }

  const result = await resolveSlug(slug);
  if (!result.ok) {
    socket.destroy();
    return;
  }

  const targetHost = result.projectId ? getContainerIp(result.projectId) : "127.0.0.1";
  const targetPort = result.containerPort || 3000;

  const upstream = net.connect(targetPort, targetHost, () => {
    upstream.write(
      `${req.method} ${req.url} HTTP/1.1\r\n` +
        Object.entries(req.headers)
          .map(([k, v]) => `${k}: ${v}`)
          .join("\r\n") +
        "\r\n\r\n",
    );
    upstream.write(head);
    socket.pipe(upstream).pipe(socket);
  });

  upstream.on("error", () => socket.destroy());
  socket.on("error", () => upstream.destroy());
});

server.listen(ROUTER_PORT, "127.0.0.1", () => {
  console.log(
    `[preview-router] Listening on 127.0.0.1:${ROUTER_PORT} (PREVIEW_API_BASE=${PREVIEW_API_BASE})`,
  );
});