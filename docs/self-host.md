# Self-host run path

CoderXP is a self-hosted Node.js application. Do not deploy it to Vercel or any Vercel service.

## Node.js

Required: Node.js `24.x` (`package.json` `engines.node`).

## Commands

```bash
npm ci
npm run build
npm run start
```

Optional port:

```bash
# Windows PowerShell
$env:PORT=3000
npm run start
```

```bash
# POSIX
PORT=3000 npm run start
```

`PORT` selects the HTTP listener. Provider credentials are never browser-exposed environment variables.

## Agent provider modes

Provider selection is **server-controlled** via `AGENT_PROVIDER`. The browser cannot choose an upstream URL or send provider credentials for Logicc mode.

### Default: Anthropic BYOK (`AGENT_PROVIDER=anthropic-byok`)

Users supply a session BYOK key through the workspace UI. The server forwards it only as `x-coderxp-byok-key` on `/api/agent/stream`. Anthropic credentials are not server environment variables in this mode.

### Logicc (OpenAI-compatible gateway) — internal only

Logicc is **disabled by default**. Enable only for loopback/private or reverse-proxy-protected deployments:

```bash
AGENT_PROVIDER=logicc
LOGICC_API_KEY=         # server-only; never NEXT_PUBLIC_; never commit
LOGICC_ALLOWED_MODELS=gpt-4o,gpt-4o-mini
LOGICC_DEFAULT_MODEL=gpt-4o
LOGICC_INTERNAL_MODE=true
```

Rules:

- `LOGICC_INTERNAL_MODE=true` is required. Without it, Logicc fails closed (`ACCESS_RESTRICTED`).
- Bind the application to localhost/private addresses when testing. Do not expose port 3000 publicly.
- Behind a trusted reverse proxy, keep the Node port unreachable from the public internet.
- Same-origin checks on agent routes mitigate cross-site requests; they are **not** authentication.
- Future authentication should gate Logicc access at the application or proxy layer (not implemented in this slice).
- Never log `LOGICC_API_KEY`, Authorization headers, or raw Logicc response bodies.

Fixed upstream origin (not browser-selectable): `https://api.logicc.cloud`.

## Health and agent endpoints

- `GET /api/agent/health` — safe status only (`ok`, `provider`/`providerId`, `ready`, `access`, `status`, `byokRequired`, display fields). No secrets, env names, upstream URLs, or quota.
- `GET /api/agent/models` — sanitized administrator-approved model list only.
- `POST /api/agent/stream` — canonical SSE agent transport. JSON body, maximum 1 MB. Connect timeout 15 s until upstream response headers. Stream timeout 180 s after headers. Concurrent stream cap is 50.

## TLS and reverse proxy

Terminate TLS at the reverse proxy. The Node process may listen on loopback HTTP.

Required proxy behavior for agent streams:

- Disable response buffering (`proxy_buffering off` or equivalent).
- Preserve `X-Accel-Buffering: no` from the application.
- Use request and read timeouts longer than the 180 s stream timeout for `/api/agent/stream`.
- Do not log `x-coderxp-byok-key` or `Authorization` request headers in access or error logs.

## Isolation headers

`/workspace` and `/workspace/*` must keep:

- `Cross-Origin-Opener-Policy: same-origin`
- `Cross-Origin-Embedder-Policy: require-corp`

The Next.js config already sets these. Do not strip them at the proxy.

## Graceful shutdown

Send `SIGTERM` to the Node process and allow in-flight SSE responses to finish or abort cleanly. Do not SIGKILL first. After exit, BYOK material does not remain on disk (session-scoped in the browser only). Server-owned Logicc keys live only in process environment / secret stores — never in project files.

## Not in this document

Docker, systemd, PM2, Nginx, and Caddy snippets are withheld until the production process model is selected. Broad end-user authentication for Logicc is a future integration point.
