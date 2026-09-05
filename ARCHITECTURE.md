# JOROS Architecture

## Status of this document
This describes what is **actually implemented and verified** in this repository, not an aspirational target. Where something is designed-for-but-not-built, it says so explicitly.

## Pipeline

```
User Idea (free text)
   │
   ▼
Intent & Requirements Analysis   (server/lib/intentAnalyzer.js)
   │  heuristic keyword/pattern extraction; LLM-backed extraction when
   │  ANTHROPIC_API_KEY + network are available, with automatic fallback
   ▼
Project Type Detection           (server/lib/projectTypeDetector.js)
   │  scored registry of known project types; each entry declares whether
   │  a real generator exists (`implemented: true/false`)
   ▼
Architecture Planning            (server/lib/planner.js)
   │  derives pages, tech stack, milestones, and a list of planned actions
   ▼
Confirmation Policy Evaluation   (server/lib/confirmationPolicy.js)
   │  classifies every planned action: SAFE / DESTRUCTIVE / COSTS_MONEY /
   │  PUBLIC_DEPLOY / NEEDS_CREDENTIAL. Anything not SAFE pauses the
   │  pipeline (see docs/CONFIRMATION_RULES.md)
   ▼
[ User Confirmation, only if required ]
   │
   ▼
Code Generation                  (server/lib/codeGenAgent.js + templates/)
   │  dispatches to the generator registered for the detected project type;
   │  if none exists, the pipeline stops and says so (status:
   │  generation_not_implemented) rather than fabricating output
   ▼
Tool Execution / Sandbox         (server/lib/sandbox.js)
   │  allowlisted commands only (npm install/run/test, node <workspace
   │  file>.js, limited git), spawned with shell:false, workspace-jailed
   │  cwd, wall-clock timeout, output cap
   ▼
Test / Build Runner              (server/lib/testRunner.js)
   │  runs install → build → test via the sandbox; a step is only ever
   │  reported "PASS" if the underlying process exited 0
   ▼
Verification                     (pipeline.js sets status: verified /
   │                              failed_checks based on actual results)
   ▼
Preview                          (server/lib/previewManager.js)
   │  a real local static file server rooted at the project's workspace,
   │  bound to an OS-assigned port on 127.0.0.1
   ▼
Iteration                        (server/lib/iterate.js)
   │  natural-language follow-up edits: a small set of real heuristic edits
   │  (color/theme changes) plus an LLM-backed general editor when a key is
   │  configured; anything unrecognized says so instead of no-op'ing silently
   ▼
Export / Deployment
      Export: the generated files are just files in workspaces/<id>/ — copy
      or zip them (no separate "export" step needed for this MVP; a
      packaging endpoint is a natural next addition, see ROADMAP).
      Deployment: NOT implemented. No provider integration exists. If asked
      to deploy, JOROS should say plainly that this isn't wired up yet
      rather than claim success.
```

## Components and where they live

| Component | File | Real / Stub |
|---|---|---|
| Web UI | `web/index.html`, `web/app.js`, `web/styles.css` | Real — vanilla JS, no build step, talks to the HTTP API |
| API server | `server/index.js` | Real — Node built-in `http`, zero dependencies |
| Project store | `server/lib/db.js` | Real but minimal — JSON flat file, single-process only |
| Workspace/path jail | `server/lib/workspace.js` | Real — every file/tool operation resolves through `safeJoin` |
| Intent analyzer | `server/lib/intentAnalyzer.js` | Real heuristics; LLM path real but unexercised without network |
| Project type detector | `server/lib/projectTypeDetector.js` | Real, extensible registry |
| Planner | `server/lib/planner.js` | Real |
| Confirmation policy | `server/lib/confirmationPolicy.js` | Real, fail-closed rule table |
| Code generator (static site / simple web app) | `server/lib/templates/staticSite/generate.js` | Real — produces working HTML/CSS/JS with a functioning cart |
| Sandbox | `server/lib/sandbox.js` | Real process-level allowlist; **not** container/VM isolated |
| Test/build runner | `server/lib/testRunner.js` | Real |
| Preview server | `server/lib/previewManager.js` | Real — actual HTTP server per project |
| Secrets manager | `server/lib/secretsManager.js` | Real — per-project `.env`, write-only API |
| LLM client | `server/lib/llmClient.js` | Real Anthropic API client (built on `https`); not network-tested in this environment |
| Android/iOS/desktop/game/API/bot/AI-agent generators | — | **Not implemented.** Detected and reported, not faked. |
| Deployment | — | **Not implemented.** |
| Container/VM sandboxing | — | **Not implemented.** Current isolation is allowlist + path-jail + timeout only. |
| Language registry | `languages/registry.js` | Real — 30 languages, computed support tiers |
| Language detection | `speech/language-detection.js` | Real heuristic (script + stopwords); no ML/acoustic model |
| STT/TTS provider abstraction | `speech/speech-to-text.js`, `speech/text-to-speech.js`, `speech/providers/` | Real interfaces; `browser` provider real & exercised, `cloud` provider real but network-untested |
| Voice command normalizer | `voice/commandNormalizer.js` | Real, small dictionary (en/fa/ps/de/ar × darker/lighter) |
| Voice UI state machine | `voice/voiceStateMachine.js` | Real, tested, shared verbatim between server tests and browser |
| i18n | `i18n/*.json`, `i18n/i18n.js` | Real for en/fa/ps/de/ar; fallback-to-English for anything else |
| Browser voice UI | `web/voice.js` | Real Web Speech API integration; **not exercised in this environment** (no browser available server-side) — see docs/ROADMAP.md |

## Why a zero-dependency Node core

This repository was built in a sandbox with no outbound network access. A framework-heavy stack (Express, React build tooling, etc.) could not have been `npm install`ed or verified to actually run here. Building the core on Node's standard library only meant every claim in this document could be — and was — checked by actually running the server and hitting it with real requests, rather than asserted from the design alone. This is a deliberate MVP tradeoff, not a long-term architectural stance; swapping in a framework later is straightforward since the module boundaries (db / workspace / sandbox / pipeline) don't depend on the HTTP layer's implementation.

## Voice / Multilingual System (added in this update)

```
Microphone (browser)
   │
   ▼
Speech-to-Text            (web/voice.js — Web Speech API, client-side, real)
   │  text sent to server, NOT audio
   ▼
POST /api/projects/:id/voice-message
   │
   ▼
Language Detection         (speech/language-detection.js)
   │  real heuristic: Unicode script + distinguishing letters + stopwords
   ▼
Command Normalization      (voice/commandNormalizer.js)
   │  maps recognized phrase -> the SAME canonical instruction string
   │  server/lib/iterate.js already understands — no duplicated edit logic
   ▼
Existing edit engine       (server/lib/iterate.js, unchanged)
   │
   ▼
Existing test/verify       (server/lib/testRunner.js, unchanged)
   │
   ▼
Localized response text    (i18n/<lang>.json)
   │
   ▼
Text-to-Speech              (web/voice.js — window.speechSynthesis, client-side, real)
   │
   ▼
Audio Response (browser)
```

Key design choice: the voice pipeline is a thin orchestration layer (`server/lib/voicePipeline.js`) that calls into `iterate.js` and `testRunner.js` exactly as the text-based `/message` endpoint does. Voice didn't get its own parallel implementation of "how to edit a project" — it reuses the one that already existed and was already tested.

### Provider abstraction

`speech/speech-to-text.js` and `speech/text-to-speech.js` are the only things the rest of the app calls (`transcribe(providerName, ...)` / `synthesize(providerName, ...)`), never a vendor SDK directly. Two providers are registered:

- **`browser`** — real, zero-configuration, executes in the browser via the Web Speech API. This is the provider actually exercised in this build.
- **`cloud`** — real HTTPS-call-shaped code (`speech/providers/cloudSpeechProvider.js`), provider-agnostic (configurable URL + key), inert until `VOICE_STT_URL`/`VOICE_STT_API_KEY` or `VOICE_TTS_URL`/`VOICE_TTS_API_KEY` are set. Not network-tested in this environment (no outbound network access here) — see docs/SECURITY.md.

### Language registry and support tiers

`languages/registry.js` holds metadata for 30 languages. Support tier is *computed*, not asserted: `SUPPORTED` requires both a real `i18n/<code>.json` translation file and a real entry in `voice/commandNormalizer.js`'s offline phrase dictionary. Right now that's `en`, `fa`, `ps`, `de`, `ar`. Everything else in the 30-language list is `PARTIALLY_SUPPORTED` (registered, browser STT/TTS can be attempted via its BCP-47 tag, but no offline command dictionary or UI translation exists yet). Any code outside the registry is `NOT_AVAILABLE`. See docs/SECURITY.md and docs/ROADMAP.md for what adding a new language involves.

### RTL/LTR

`fa`, `ps`, `ar`, `ur`, `he` are RTL. `document.body.dir` is set client-side in `web/voice.js::applyLanguage()` and again per voice response (`body.direction` from `/voice-message`), so the UI direction follows whichever language is actually active, not just the page's initial load language.



Adding Android, iOS, desktop, games, APIs, bots, or AI agents means:
1. Add an entry to `projectTypeDetector.REGISTRY` with real detection scoring.
2. Implement a generator module under `server/lib/templates/<type>/generate.js` that returns real files for that platform's actual toolchain (e.g. a `build.gradle`-based Android project, not an HTML mockup labeled "Android").
3. Register it in `codeGenAgent.GENERATORS`.
4. Extend `testRunner.js` and `sandbox.js`'s allowlist if the platform needs different build tools (e.g. `./gradlew`, `xcodebuild`) — each addition should be a narrow, justified allowlist entry, not a broadening to "run anything."

Nothing in `pipeline.js` needs to change for this — that's the intended extension point.
