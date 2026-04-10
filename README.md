# Rural Health Helper

Rural Health Helper is a FastAPI + web frontend project for:
- Patient login/signup, consultation, uploads, disease search
- Vendor login/signup, store details, medicine listing
- Admin login and management flows

## Tech Stack
- Backend: FastAPI (`main.py`)
- Frontend: static HTML/CSS/JS (`frontend/`)
- Storage: JSON files in `data/` (local) or `/tmp` (Vercel runtime)

## Project Structure
- `main.py`: main API + static mounts
- `frontend/index.html`: main web UI
- `frontend/admin.html`: admin web UI
- `frontend/app.js`: frontend app logic
- `frontend/styles.css`: frontend styles
- `data/`: JSON data store
- `vercel.json`: Vercel deployment config

## Local Run (Windows PowerShell)
1. Create and activate venv:
```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
```

2. Install dependencies:
```powershell
pip install -r requirements.txt
```

3. Start app:
```powershell
python -m uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

4. Open:
- App: `http://127.0.0.1:8000`
- API docs: `http://127.0.0.1:8000/docs`

## Vercel Deploy
From project root:
```powershell
cmd /c npx vercel@latest --prod
```

Recommended prompt choices:
- Link to existing project: `yes` (if already created) or `no` (first deploy)
- Root directory: `.`
- Connect GitHub repository: optional

## Notes
- Vercel serverless storage is ephemeral. Runtime data in `/tmp` is temporary.
- For production persistence, move to a real database.
