# BidForge — RFP intelligence frontend

A premium, responsive Next.js frontend for the uploaded FastAPI + Celery + LangGraph + RAG proposal-generation backend. It uses Tailwind CSS, Framer Motion, GSAP ScrollTrigger, and Three.js (for the restrained, cursor-reactive 3D hero scene). The visual direction is editorial/enterprise: warm white surfaces, charcoal hero, sage/forest accents and small amber details; no pink/purple palette or heavy neon glow.

## What is included

- Hero landing page with Three.js mouse-reactive background and Framer Motion entrance transitions.
- GSAP ScrollTrigger reveals as sections enter the viewport.
- Source URL form wired to `POST /api/generate_proposal` with `{ "url": "..." }`.
- Live polling of `GET /api/task-status/{task_id}` every 2.2 seconds while a Celery task is active.
- Clear queue/running/success/failure states, task ID, status errors and elapsed time.
- Proposal text display, copy, Markdown export and browser-local recent run history.
- Responsive navigation, capability sections, workflow map, setup instructions and the “Mr Faizan” creator credit.
- Accessibility support for reduced-motion preferences and keyboard-native form controls.

## 1. Requirements

- Node.js 20.9+ (Node 22 LTS recommended for a new setup).
- Your Python backend dependencies installed.
- Redis running and reachable at the `REDIS_URL` value used by FastAPI and Celery.
- The required LLM/API credentials configured in the backend environment.

## 2. Start the Python services

Use two terminals from the backend project directory.

**Terminal A — FastAPI**

```powershell
python langgraph_main.py
```

The uploaded backend starts Uvicorn on `http://127.0.0.1:8800`.

**Terminal B — Celery worker**

Use the same Python virtual environment and environment variables as FastAPI:

```powershell
celery -A langgraph_main.celery_app worker --loglevel=INFO --pool=solo
```

`--pool=solo` is a practical local-development option on Windows. For production, run Redis and Celery under your deployment's supported process environment and supervise the worker separately from the web server.

Check that the API documentation opens at `http://127.0.0.1:8800/docs` before testing the frontend.

## 3. Start the frontend

From this folder:

```powershell
npm install
Copy-Item .env.local.example .env.local
npm run dev
```

Open `http://localhost:3000`.

The example environment file contains:

```env
NEXT_PUBLIC_API_BASE_URL=http://127.0.0.1:8800
```

Change this value if your FastAPI service runs elsewhere. Restart the Next.js dev server after changing `.env.local`.

## 4. Backend endpoints used

The frontend intentionally matches the uploaded `langgraph_main.py` routes:

- `POST /api/generate_proposal` — JSON body: `{ "url": "https://..." }`; expected response includes `task_id`.
- `GET /api/task-status/{task_id}` — returns the Celery state and, after completion, its result/error.

## Important backend integration notes

The uploaded API is close to what this UI needs, but a fully polished production workflow needs a few backend changes. The frontend does **not** fabricate internal agent progress; right now it can track real Celery states only. To expose per-node “scraper / RAG / analyst / writer / critic / human review” telemetry, emit LangGraph node events to a persistent task-progress store and return them from a status endpoint (for example `progress`, `current_node`, and timestamped `events`).

The current graph calls `interrupt()` at `human_checkpoint_node`, but the shown API has no checkpoint-resume endpoint. That means the UI cannot submit human approval/edits, and the final `final_proposal` may be missing even when the worker reports success. Add a resume route which accepts the LangGraph thread/checkpoint identifier and human payload, invokes the graph with `Command(resume=...)`, and returns the final state. Also make sure the Celery task uses a unique thread ID **per task** and returns a serializable final state.

For browser integration, configure FastAPI CORS to allow your frontend origin (for local dev, `http://localhost:3000`). Do not expose API secrets or Redis credentials in any `NEXT_PUBLIC_*` frontend variable. In production, consider authentication, rate limits, URL allowlisting/SSRF protection, request size limits, result retention rules, and server-side logs/audit trails.

## Notes

- Recent runs are stored in the current browser's `localStorage`, not in a central database.
- The Markdown download is generated in the browser and does not write files onto the backend server.
- If the browser reports a CORS error, check the FastAPI CORS middleware and the API URL before changing frontend code.
