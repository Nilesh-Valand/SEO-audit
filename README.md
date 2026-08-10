# SEO Audit

FastAPI + SQLite backend and a Next.js web frontend (App Router). No Docker, no Postgres, no Chrome extension.

| Path | Role |
|------|------|
| `/backend` | FastAPI API, crawler, rules engine, exports (CSV / Excel / PDF) |
| `/frontend-web` | Next.js dashboard (React + TypeScript + Tailwind) |

---

## Backend

### Requirements

- Python 3.11+
- SQLite (file DB; no Postgres)

### Setup

```bash
cd backend
python -m venv venv

# Windows
.\venv\Scripts\activate

# macOS / Linux
# source venv/bin/activate

pip install -r requirements.txt
copy .env.example .env   # or: cp .env.example .env
alembic upgrade head
```

Optional (JS rendering for thin pages):

```bash
playwright install chromium
```

### Run

```bash
cd backend
uvicorn app.main:app --reload --reload-dir app --host 127.0.0.1 --port 8000
```

`--reload-dir app` watches only Python code under `app/`, so crawl snapshots written to `backend/data/snapshots/` do not restart the server mid-audit.

- Health: http://127.0.0.1:8000/api/health
- Docs: http://127.0.0.1:8000/docs

### Config (`backend/.env`)

| Variable | Purpose |
|----------|---------|
| `DB_URL` | SQLite URL (default `sqlite:///./app/db/audit.db`) |
| `ALLOWED_ORIGINS` | Comma-separated CORS origins (include `http://localhost:3000` for the Next.js app) |
| `ENABLE_PAGESPEED` | Optional PageSpeed enrichment (`false` by default) |
| `PAGESPEED_API_KEY` | PageSpeed API key (only if enrichment is enabled) |

Example:

```env
ALLOWED_ORIGINS=http://localhost:3000,http://127.0.0.1:3000
```

Restart uvicorn if you change CORS.

---

## Web frontend (`frontend-web`)

Next.js App Router UI that talks to the FastAPI backend via `NEXT_PUBLIC_API_BASE_URL`.

### Requirements

- Node.js 18+

### Setup

```bash
cd frontend-web
npm install
copy .env.example .env.local   # or: cp .env.example .env.local
```

`.env.local`:

```env
NEXT_PUBLIC_API_BASE_URL=http://127.0.0.1:8000
```

### Develop

```bash
cd frontend-web
npm run dev
```

Open http://localhost:3000

### Production build

```bash
cd frontend-web
npm run build
npm run start
```

- `next build` — compile for production
- `next start` — serve the production build (default http://localhost:3000)

### Deploy on Vercel

1. Push the repo and import the project in [Vercel](https://vercel.com/new)
2. Set **Root Directory** to `frontend-web`
3. Add env var `NEXT_PUBLIC_API_BASE_URL` pointing at your hosted FastAPI API
4. Ensure the backend `ALLOWED_ORIGINS` includes your Vercel URL (e.g. `https://your-app.vercel.app`)
5. Deploy

Or from the CLI:

```bash
cd frontend-web
npx vercel
```

---

## License

Private / internal use unless otherwise noted.
