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

`PORT` is the only supported process environment variable for the HTTP listener. Anthropic credentials are **not** server environment variables. Users supply a session BYOK key through the workspace UI; the server forwards it only as `x-coderxp-byok-key` on `/api/agent/stream`.

## Health and agent endpoints

- `GET /api/agent/health` — public metadata (`ok`, `provider: "anthropic"`, `byokRequired: true`).
- `POST /api/agent/stream` — canonical SSE agent transport. JSON body, maximum 1 MB. Connect timeout 15 s until upstream response headers. Stream timeout 180 s after headers. Concurrent stream cap is 50.

## TLS and reverse proxy

Terminate TLS at the reverse proxy. The Node process may listen on loopback HTTP.

Required proxy behavior for agent streams:

- Disable response buffering (`proxy_buffering off` or equivalent).
- Preserve `X-Accel-Buffering: no` from the application.
- Use request and read timeouts longer than the 180 s stream timeout for `/api/agent/stream`.
- Do not log the `x-coderxp-byok-key` request header in access or error logs.

## Isolation headers

`/workspace` and `/workspace/*` must keep:

- `Cross-Origin-Opener-Policy: same-origin`
- `Cross-Origin-Embedder-Policy: require-corp`

The Next.js config already sets these. Do not strip them at the proxy.

## Graceful shutdown

Send `SIGTERM` to the Node process and allow in-flight SSE responses to finish or abort cleanly. Do not SIGKILL first. After exit, no BYOK material remains on disk; keys are session-scoped in the browser only.

## Not in this document

Docker, systemd, PM2, Nginx, and Caddy snippets are withheld until the production process model is selected.
