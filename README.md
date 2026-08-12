# CoderXP

Premium AI coding platform. Next.js 16, React 19, TypeScript, Tailwind CSS 4.

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 16.3.0 (App Router) |
| UI | React 19.2.8, Tailwind CSS 4, Radix UI (shadcn/ui), Lucide icons |
| Editor | CodeMirror 6 (@uiw/react-codemirror) |
| Runtime | WebContainer API (@webcontainer/api) |
| Animation | Framer Motion 11 |
| Language | TypeScript (strict mode) |
| Node | 24.x |
| Linting | ESLint 9.39.5 (flat config) |
| Package manager | npm |

## Project Structure

```
coderxp/
├── app/                        # Next.js App Router pages
│  ├── page.tsx                 # Homepage (hero, features, persons)
│  ├── workspace/               # Workspace page (M2)
│  │  ├── WorkspaceShell.tsx    # Workspace orchestrator
│  │  ├── WorkspaceClient.tsx   # Client wrapper
│  │  ├── components/           # Editor, tabs, file tree, project launcher
│  │  └── hooks/                # useWorkspaceState, useEditorPersistence
│  ├── about/                   # About page
│  ├── features/                # Features page
│  ├── pricing/                 # Pricing page
│  ├── models/                  # Models page
│  ├── docs/                    # Docs page
│  ├── contact/                 # Contact page
│  ├── security/                # Security page
│  ├── privacy/                 # Privacy page
│  ├── terms/                   # Terms page
│  ├── cookies/                 # Cookies page
│  ├── api/                     # API page
│  ├── bring-your-own-key/      # Bring Your Own Key page
│  ├── local-models/            # Local model bridge page
│  ├── layout.tsx               # Root layout
│  ├── sitemap.ts               # Sitemap generator
│  └── robots.ts                # Robots generator
├── components/                 # React components
│  ├── landing/                 # HeroVideo and landing components
│  └── navigation/              # GlobalHeader, EnterpriseFooter
├── lib/                        # Shared libraries (M2)
│  └── workspace/               # Workspace core: types, persistence, templates, runtime
├── public/                     # Static assets (logo, posters, OG image)
├── next.config.mjs             # Next.js config (SEO, COEP/COOP for WebContainer)
├── eslint.config.mjs           # ESLint flat config
└── package.json
```

## Commands

```bash
npm install
npm run dev                     # Development server
npm run build                   # Production build
npm run lint                    # ESLint
npm run typecheck               # TypeScript check (if configured)
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

Branch: `feat/m2-workspace-alpha` (remote head: `961cbdf`)

Commits delivered:
1. **Commit 1** — Foundation: WorkspaceShell, types, path validation
2. **Commit 2** — Persistence (IndexedDB), path validation utilities, static HTML/CSS/JS project template. Published and closed on remote GitHub.
3. **Commit 3** — Local project lifecycle: project CRUD, file tree, rename, delete with confirmation, project switching. Published and closed on remote GitHub. Five correction iterations:
   - **d6b1b7** — State-integrity correction (10 review points)
   - **8c0ec60** — Lifecycle races correction (8 review points)
   - **24488a8** — Final lifecycle races correction
   - **fe3610c** — Retry/ownership correction (7 review points)
   - **fdd0f81** — Operation-guard unification (token-owned WorkspaceOperationOwner)
4. **Commit 4** (`961cbdf`) — CodeMirror 6 editor with tab management and IndexedDB file persistence. Includes lossless editor persistence (useEditorPersistence hook) and lifecycle invariant preservation. Published and closed on remote GitHub.
5. **Commit 5** (`fe97de1`) — Static runtime and live preview via WebContainer API. Delivered as git bundle/patch artifacts via Ping. Awaiting Paul's review before publication.

Build: 21/21 pages, 0 vulnerabilities, lint and TypeScript clean.

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