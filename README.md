# JOROS — AI Software Builder

An AI software builder with a web UI: describe a project in plain language (by typing or, where your browser supports it, by voice — including several non-English languages), and JOROS analyzes the request, plans an architecture, generates real project files, runs a real build/test pipeline in a sandboxed workspace, and serves a live preview.

This is an MVP foundation, and this README says exactly what works and what doesn't — see "Known limitations" below and `docs/ARCHITECTURE.md` for the full breakdown.

## Requirements

- Node.js **>= 18**
- No `npm install` is required to run the server itself — it has **zero npm dependencies**, only Node's standard library.
- A modern browser for the voice features (Chrome or Edge recommended — they have the most complete Web Speech API support; see "Known limitations").

## Quick start (local)

```bash
git clone <this-repo>
cd joros
node server/index.js
```

Then open **http://localhost:4790** in a browser.

That's it — no build step, no `npm install`, no database to provision. The server is plain Node against its own standard library.

Startup prints exactly what's enabled, e.g.:
```
JOROS listening on 0.0.0.0 (all interfaces):4790 (visit http://localhost:4790 locally)
Health check: http://localhost:4790/health
LLM generation: OFFLINE (template fallback only)
```

### Custom port / host

```bash
PORT=5000 node server/index.js
```

The server binds `0.0.0.0` (all network interfaces) by default — not just `localhost` — so it's reachable from other machines/containers on the port without extra configuration. Override with `HOST=127.0.0.1 node server/index.js` if you want it loopback-only for local-only use.

### Health check

```bash
curl http://localhost:4790/health
```
```json
{ "status": "ok", "service": "joros", "uptimeSeconds": 12, "timestamp": "2026-01-01T00:00:00.000Z" }
```
Use this for container/orchestrator liveness and readiness probes.

## Environment variables

All optional. JOROS runs fully offline (text-mode code generation, no voice cloud provider, no LLM) with none of these set.

| Variable | Purpose | Required for |
|---|---|---|
| `PORT` | HTTP port (default `4790`) | — |
| `ANTHROPIC_API_KEY` | Enables LLM-backed requirement analysis and general-purpose code/CSS editing | Richer intent analysis and the LLM fallback path in `server/lib/iterate.js`. Without it, JOROS uses its offline heuristic analyzer and offline command dictionary, which cover the demo use cases (restaurant/store website, darker/lighter theme edits) but not arbitrary free-form edits. |
| `VOICE_STT_URL` + `VOICE_STT_API_KEY` | Enables the `cloud` speech-to-text provider | Server-side transcription. **Not required** for voice input generally — the default `browser` provider (Web Speech API) needs no credentials at all. |
| `VOICE_TTS_URL` + `VOICE_TTS_API_KEY` | Enables the `cloud` text-to-speech provider | Server-side synthesis. **Not required** for voice output generally — the default `browser` provider (`window.speechSynthesis`) needs no credentials. |

Set them however your shell/host prefers, e.g.:

```bash
export ANTHROPIC_API_KEY=sk-ant-...
node server/index.js
```

Per-project secrets (e.g. a Stripe key for a generated checkout flow) are **not** environment variables — those are configured per project through the running app via `POST /api/projects/:id/secrets`, and are stored only in that project's own `workspaces/<id>/.env` file. See `docs/SECURITY.md`.

## Running the test suite

```bash
node tests/run-all.js
```

This runs 7 test modules (unit tests for language detection, i18n, the command normalizer, the voice UI state machine, and the speech-provider abstraction, plus a full integration test that spawns the real server and drives it over HTTP, including a complete voice-command flow in Persian). No test framework dependency — plain Node + the built-in `assert` module, so it runs with zero `npm install`.

## Production deployment

There is no bundler/build step to run — you deploy the source as-is. Verified working steps:

1. **Get the code onto the host** (git clone or copy the repository — no build artifacts to produce first, no `npm install` required for the server itself).
2. **Set environment variables** you want enabled (see table above) — at minimum consider `ANTHROPIC_API_KEY` for richer generation; voice cloud credentials only if you have a real provider to point at (the `browser` voice path needs nothing). Never put secrets in source — `.env` files are git-ignored (`.gitignore` covers `.env`, `.env.*`, `data/*.json`, and `workspaces/`), and confirmed via `git check-ignore` / `git add -A --dry-run` that nothing under `data/` (except the empty `.gitkeep` placeholder) or `workspaces/` would ever be committed.
3. **Start it**: `npm start` (defined in `package.json` as `node server/index.js`) or directly `node server/index.js`.
4. **Binding**: the server binds `0.0.0.0:$PORT` by default (default port `4790`) — confirmed by inspecting the actual listening socket and by hitting the health endpoint through the host's real (non-loopback) network interface, not just `localhost`. Override the port with `PORT=<n>`, or the bind address with `HOST=<addr>` if you specifically want loopback-only.
5. **Health check**: `GET /health` returns `{"status":"ok","service":"joros","uptimeSeconds":N,"timestamp":"..."}` with HTTP 200 — wire this into your process manager/orchestrator's liveness and readiness probes.
6. **Run behind a process manager** so it restarts on crash and on host reboot, e.g.:
   ```ini
   # example systemd unit
   [Unit]
   Description=JOROS
   After=network.target

   [Service]
   Environment=PORT=4790
   Environment=ANTHROPIC_API_KEY=sk-ant-...
   ExecStart=/usr/bin/node /opt/joros/server/index.js
   Restart=on-failure
   User=joros

   [Install]
   WantedBy=multi-user.target
   ```
   or an equivalent process manager (pm2, supervisord, a container orchestrator's restart policy, etc.) — any of these work since the app is just `node server/index.js` and reads `PORT`/`HOST` from the environment.
7. **Put a reverse proxy in front of it** (nginx/Caddy/similar) for TLS termination and to expose it on port 443 instead of 4790 directly. JOROS itself does not implement HTTPS.
8. **Persist `data/` and `workspaces/`** across deploys/restarts (they hold the project index and generated project files) — mount them as a persistent volume if you're deploying in a container.
9. **Do not put this on the open internet without your own access control.** As documented in `docs/SECURITY.md`, this MVP has no built-in authentication or rate limiting on its API — it assumes a trusted operator or a reverse proxy handling auth in front of it.

### Preview servers stay loopback-only, intentionally
Per-project live preview servers (`server/lib/previewManager.js`) bind `127.0.0.1` only, even in production — this is deliberate, not an oversight left over from local development. They serve a project's generated files on an OS-assigned port with no authentication of their own, so binding them publicly would let anyone who can reach the host view any project's generated output. If you need previews reachable from outside the host, add your own authenticated reverse-proxy route rather than changing this binding.

### What is explicitly NOT implemented for deployment
- No one-click deploy-the-generated-project-to-a-host feature. Generated projects live in `workspaces/<id>/` as plain files — copy, zip, or `rsync` them to wherever you want to actually host the generated site. See `docs/ROADMAP.md` item 7.
- No container image is provided in this repo (nothing prevents building one — it's just `FROM node:18` + copy + `CMD ["node","server/index.js"]` — it just hasn't been done here).
- No TLS/HTTPS termination — put a reverse proxy in front for that.
- No authentication/rate limiting on the API — see point 9 above.

## Languages / voice

- **30 languages** are registered (`GET /api/languages`). Five — English, Dari/Persian, Pashto, German, Arabic — are `SUPPORTED`: full UI translation (`i18n/`) and an offline voice/text command dictionary. The rest are `PARTIALLY_SUPPORTED`: registered with a BCP-47 tag so the browser can attempt speech recognition/synthesis, but without offline UI translation or command handling yet.
- Voice input/output uses your **browser's** built-in Web Speech API by default — no API key needed, nothing sent to any third-party cloud service for this path. Chrome and Edge have the most complete support; Firefox and Safari support varies, and JOROS reports "this browser does not support voice input" honestly rather than pretending it works.
- See `docs/ARCHITECTURE.md` for the full voice pipeline and `docs/SECURITY.md` for exactly what's server-side vs. client-side.

## Known limitations

- **Offline by default in this repository's build/test environment**: it was built and tested with no outbound network access, so the LLM path and cloud voice provider path are real code that has not been exercised against live services. See `docs/ARCHITECTURE.md`.
- **Only two project types have real generators**: static websites and simple (static) web apps. Android/iOS/desktop/game/API/bot/AI-agent are detected but the pipeline stops and says so (`status: generation_not_implemented`) instead of faking output.
- **No deployment integration.** Generated code is real, runnable files on disk — getting them onto a live host is a manual step today.
- **Sandbox is process-level, not container-level.** See `docs/SECURITY.md`.
- **Browser mic interaction has not been manually tested** in this environment (no browser available server-side) — everything it depends on (state machine, detection, normalization, i18n) is tested; the actual click-the-mic-and-talk flow needs to be checked in a real browser. See `docs/ROADMAP.md` item 1.

## Project layout

```
joros/
├── server/            API server + orchestration pipeline (Node, zero deps)
│   ├── index.js
│   └── lib/           db, workspace, sandbox, planner, pipeline, voicePipeline, ...
├── web/                Browser UI (vanilla HTML/CSS/JS, no build step)
├── languages/          Language registry (30 languages, computed support tiers)
├── speech/             STT/TTS provider abstraction + language detection
│   └── providers/      browser delegate (real) + cloud stub (real, untested here)
├── voice/              Command normalizer + voice UI state machine (shared server/browser)
├── i18n/                UI translation files (en/fa/ps/de/ar) + loader
├── tests/               Full test suite (plain Node + assert, no framework dep)
├── docs/                 ARCHITECTURE.md, SECURITY.md, CONFIRMATION_RULES.md, ROADMAP.md
├── data/                 Project index (created at runtime, gitignored)
└── workspaces/           Generated projects live here (created at runtime, gitignored)
```
