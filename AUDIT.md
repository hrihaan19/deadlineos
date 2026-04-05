# AUDIT.md — Pre-Build Codebase Audit

## Stack Identification
- **Framework:** None — plain HTML/CSS static site
- **Node version:** v25.8.2
- **Package manager:** npm
- **Entry point:** `index.html`
- **TypeScript:** No
- **Tailwind:** No (was CDN-loaded for previous Sscript clone project)
- **CSS Framework:** None — custom CSS
- **Routing:** None — single page

## Claude API Integration
- **Where called:** Nowhere — no existing integration
- **Model:** N/A
- **API key:** No `.env` file present
- **Streaming:** N/A

## Existing Components
| File | Status | Action |
|------|--------|--------|
| `index.html` | Sscript.app clone — previous project | Replace with DeadlineOS SPA |
| `serve.mjs` | Static file server on port 3000 | Keep + extend with `/api/claude` proxy |
| `screenshot.mjs` | Puppeteer screenshot utility | Keep as-is |
| `package.json` | `type: commonjs`, puppeteer devDep | Extend with Anthropic SDK |
| `CLAUDE.md` | Project instructions | Keep untouched |

## Design System (current — Sscript clone)
- Fonts: Instrument Sans (Google Fonts)
- Colors: `--color-black--100: #000`, `--color-blue: #146ef5`
- Scheme: Dark → replace wholesale with DeadlineOS palette

## Data Layer
- Database: None
- Auth: None
- Schema: None

## Assessment & Build Plan

**Stack stays:** plain HTML + vanilla JS ES Modules (no framework, per pivot rules)

**Pivots applied:**
- Supabase → localStorage adapter (mirror Supabase client interface)
- Recharts → Chart.js (CDN) — no React in scope
- TypeScript interfaces → JSDoc type comments in `/lib/`
- Claude CORS → extend `serve.mjs` + Vercel serverless `api/claude.js` to proxy
- date-fns → CDN UMD build (`window.dateFns`)

**New file structure:**
```
/
├── index.html           # SPA shell
├── styles.css           # DeadlineOS design system
├── app.js               # Main app controller + all render logic
├── lib/
│   ├── storage.js       # localStorage adapter
│   ├── scheduler.js     # Scheduling algorithm
│   ├── procrastination.js # Stats calculations
│   ├── prompts.js       # Claude prompt templates
│   └── claude.js        # Claude API client
├── data/
│   └── demo.js          # Seed data + loadDemoData()
├── api/
│   └── claude.js        # Vercel serverless function (Claude proxy)
├── vercel.json          # Deployment config
└── .env.example         # ANTHROPIC_API_KEY placeholder
```
