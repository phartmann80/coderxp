# CoderXP

Premium AI coding platform. Next.js 16, React 19, TypeScript, Tailwind CSS 4.

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 16.3.0 (App Router) |
| UI | React 19.2.8, Tailwind CSS 4, Radix UI (shadcn/ui), Lucide icons |
| Language | TypeScript (strict mode) |
| Runtime | Node 24.x |
| Linting | ESLint 9.39.5 (flat config) |
| Package manager | npm |

## Project Structure

```
coderxp/
├── app/                    # Next.js App Router pages
│   ├── page.tsx            # Homepage (hero, features, personas)
│   ├── workspace/          # Workspace page
│   ├── models/             # Models page
│   ├── byok/               # Bring Your Own Key page
│   ├── features/           # Features page
│   ├── local-models/       # Local model bridge page
│   ├── layout.tsx          # Root layout
│   ├── favicon.ico         # Favicon (16/32/48px)
│   └── icon.png            # Apple touch icon (180x180)
├── components/             # React components
│   ├── HeroVideo.tsx       # Cinematic hero with poster + controlled motion
│   └── ...
├── public/                 # Static assets (logo, posters, OG image)
├── next.config.mjs         # Next.js config (metadataBase, canonical, SEO)
├── eslint.config.mjs       # ESLint flat config
└── package.json
```

## Commands

```bash
npm install
npm run dev                # Development server
npm run build               # Production build
npm run lint                # ESLint
npm run typecheck           # TypeScript check (if configured)
```

## Milestones

### Milestone 1 — Landing Page (Complete)

PR #1 merged: audit, truthfulness, and hero-behavior corrections.
PR #3 merged: M1 final scope cleanup (hero comment terminology fix).
PR #4 merged: Next.js 14 to 16 migration, React 18 to 19, ESLint 9 flat config.

- Responsive poster optimization (next/image, WebP)
- Logo compression (1.3MB to 11KB)
- WCAG AA contrast fixes
- Favicon and apple touch icon
- videoEnabled flag (hero uses static imagery, not video)
- Simulated terminal removed, replaced with honest architecture concept labels
- Product claim corrections across all pages
- Lucide SVG icons
- SEO: metadataBase, canonical URL, OpenGraph, Twitter cards, sitemap.ts, robots.ts
- Lighthouse: desktop 100, mobile 92, accessibility 100
- 0 vulnerabilities (clean install audit)

### Milestone 2 — Workspace Alpha (In Progress)

Branch: `feat/m2-workspace-alpha` (remote head: `1465eab`)

Commits delivered:
1. **Commit 1** — Foundation: WorkspaceShell, types, path validation
2. **Commit 2** — Persistence (IndexedDB), path validation utilities, static HTML/CSS/JS project template. Published and closed on remote GitHub.
3. **Commit 3** — Local project lifecycle: project CRUD, file tree, rename, delete with confirmation, project switching. Delivered as git bundles/patches via Ping (not pushed to remote). Five correction iterations applied on top of the original delivery:
   - **d6b1b72** — State-integrity correction (10 review points)
   - **8c0ec60** — Lifecycle races correction (8 review points)
   - **24488a8** — Final lifecycle races correction
   - **fe3610c** — Retry/ownership correction (7 review points)
   - **fdd0f81** — Operation-guard unification (token-owned WorkspaceOperationOwner)

   Latest commit `fdd0f81` accepted for review by Paul. Awaiting final decision.

Build: 21/21 pages on main, 0 vulnerabilities, lint and TypeScript clean.

## Branches

| Branch | Purpose | Status |
|---|---|---|
| `main` | Production (M1 + Next.js 16 migration merged) | Active |
| `feat/m2-workspace-alpha` | M2 workspace development | Active (M2 in progress) |
| `audit/matteo-milestone-1` | M1 audit branch | Merged, deletable |
| `chore/nextjs-16-upgrade` | Next.js 16 migration | Merged via PR #4, deletable |
| `fix/milestone-1-truth-and-preview` | M1 truth/preview fix | Stale, deletable |

## Security

Never commit `.env.local`, signing keys, API keys, keystores, or production credentials. `.env.example` contains variable names only.

## Domain

Production target: `coderxp.pro`