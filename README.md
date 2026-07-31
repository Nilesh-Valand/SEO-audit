# SEO Audit

FastAPI + SQLite backend and a Chrome Manifest V3 extension (full-tab dashboard). No Docker, no Postgres, no Next.js frontend.

| Path | Role |
|------|------|
| `/backend` | FastAPI API, crawler, rules engine, exports (CSV / Excel / PDF) |
| `/extension` | Chrome extension UI (Vite + React + TypeScript + Tailwind) |

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
| `ALLOWED_ORIGINS` | Comma-separated CORS origins (set `chrome-extension://YOUR_ID` after loading) |
| `ENABLE_PAGESPEED` | Optional PageSpeed enrichment (`false` by default) |
| `PAGESPEED_API_KEY` | PageSpeed API key (only if enrichment is enabled) |

In `ENV=development`, `chrome-extension://` origins are reflected automatically so Test Connection works before you pin the ID.

---

## Chrome extension

### Build (local testing)

```bash
cd extension
npm install
npm run build
```

Output lands in `extension/dist`.

### Load unpacked

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. **Load unpacked** → select `extension/dist`
4. Click the toolbar icon → full-tab dashboard opens
5. Open **Settings** → confirm backend URL `http://127.0.0.1:8000` → **Test Connection**

Copy the extension ID from `chrome://extensions` into `backend/.env`:

```env
ALLOWED_ORIGINS=chrome-extension://YOUR_EXTENSION_ID
```

Restart uvicorn if you change CORS.

### Package for Chrome Web Store

```bash
cd extension
npm run package
```

Creates `extension/releases/seo-audit-extension-v0.1.0.zip` (contents of `dist/`, without source maps). Upload that zip in the [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole):

1. Pay the one-time developer registration fee if needed  
2. **New item** → upload the zip  
3. Fill listing details, privacy practices, and screenshots  
4. Submit for review  

After publication, users install from the Store; they still need a reachable backend URL configured in Settings (or ship a hosted API and document the default URL).

---

## License

Private / internal use unless otherwise noted.
