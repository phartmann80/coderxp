# CoderXP

Premium AI coding platform. Next.js 16, React 19, TypeScript, Tailwind CSS 4.

## Tech Stack

| Layer | Technology |
|-------|------------|
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
├── public/                # Static assets (logo, posters, OG image)
├── next.config.ts          # Next.js config (metadataBase, canonical, SEO)
├── eslint.config.mjs       # ESLint flat config
└── package.json
```

## Commands

```bash
npm install
npm run dev          # Development server
npm run build        # Production build
npm run lint         # ESLint
npm run typecheck    # TypeScript check (if configured)
```

## Milestones

### Milestone 1 — Landing Page (Complete)

PR #1 merged: audit, truthfulness, and hero-behavior corrections.
- Responsive poster optimization (next/image, WebP)
- Logo compression (1.3MB to 11KB)
- WCAG AA contrast fixes
- Favicon and apple touch icon
- videoEnabled flag (hero uses static imagery, not video)
- Simulated terminal removed, replaced with honest architecture concept labels
- Product claim corrections across all pages
- Lucide SVG icons
- SEO: metadataBase, canonical URL, OpenGraph, Twitter cards, sitemap.ts, robots.ts
- Lighthouse: desktop 98, mobile 99, accessibility 100

### Milestone 2 — Workspace Alpha (In Progress)

Branch: `feat/m2-workspace-alpha` (head: `1465eab`)

Commits delivered:
1. **Commit 1** — Foundation: WorkspaceShell, types, path validation
2. **Commit 2** — Persistence (IndexedDB), path validation utilities, static HTML/CSS/JS project template. Published and closed on remote.
3. **Commit 3** — Local project lifecycle: project CRUD, file tree, rename, delete with confirmation, project switching. Delivered, awaiting review.

Build: 21/21 pages, 0 vulnerabilities, lint and TypeScript clean.

## Branches

| Branch | Purpose |
|--------|---------|
| `main` | Production (M1 merged) |
| `feat/m2-workspace-alpha` | M2 workspace development |
| `audit/matteo-milestone-1` | M1 audit branch (merged) |

## Security

Never commit `.env.local`, signing keys, API keys, keystores, or production credentials. `.env.example` contains variable names only.

## Domain

Production target: `coderxp.pro`