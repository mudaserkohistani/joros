# Security

This documents what is actually implemented, verified by the tests and manual checks referenced below — not a security target.

## Secrets

- Secrets (API keys, provider credentials) are configured **only** via `POST /api/projects/:id/secrets`, which writes to `workspaces/<id>/.env`.
- `.env` is covered by the repo-root `.gitignore` **and** by a per-project `.gitignore` entry written the first time a secret is set (`server/lib/secretsManager.js::ensureProjectGitignoreHasEnv`), so it's excluded even if someone `git init`s inside a single project's workspace.
- The secrets API is write-only: `GET /api/projects/:id/secrets` returns only `{ key, configured: true/false }` — never the value. Verified by an automated test (`tests/integration.voice.test.js`) that sets a canary secret value and asserts it does not appear anywhere in:
  - the project's own `GET` response (log, plan, everything)
  - the secrets status endpoint
  - the server's stdout log
  - any generated project source file
- Verified manually (this session) with a second canary value and the same four checks, plus a fifth: confirmed the value exists **only** inside the project's `.env` file on disk.
- `server/lib/codeGenAgent.js` additionally scans every file a generator produces for secret-shaped strings (`sk_live_`, `sk_test_`, AWS key patterns, PEM private key headers) before writing it, and refuses to write if one is found. This is defense-in-depth for a bug that hasn't happened yet, not a response to one that has.
- The Anthropic API key (`ANTHROPIC_API_KEY`) and voice provider credentials (`VOICE_STT_API_KEY`, `VOICE_TTS_API_KEY`) are read from `process.env` only, server-side, in `server/lib/llmClient.js` and `speech/providers/cloudSpeechProvider.js`. Verified: `grep -rn "process.env" web/` returns nothing — the frontend bundle contains zero references to any environment variable or credential.

## Sandboxed execution

- `server/lib/sandbox.js` runs commands via `child_process.spawn` with `shell: false` — command strings are never passed through a shell interpreter, so `;`, `&&`, backticks, `$()` etc. are inert.
- A fixed allowlist (`npm install|ci|run|test`, `node <file>.js` inside the workspace, a handful of read-only `git` subcommands) is the only thing that can execute. Anything else is rejected before a process is even spawned.
- Verified this session: `rm -rf /`, `bash -c "echo pwned"`, and `npm publish` were all directly tested against the sandbox module and all three were rejected with `denied: true` and no process spawned.
- Every command runs with `cwd` locked to `workspaces/<projectId>` via `workspace.js::workspacePath`, and all file paths are resolved through `workspace.js::safeJoin`, which throws if a resolved path would escape the workspace root (blocks `../../` traversal).
- **Explicit limitation**: this is process-level isolation on the same kernel as the JOROS server, not container/VM isolation. It is not sufficient defense-in-depth for untrusted or adversarial input at production scale — see ROADMAP.md.

## API keys and provider credentials — what's server-side only

| Credential | Where it's read | Ever sent to browser? |
|---|---|---|
| `ANTHROPIC_API_KEY` | `server/lib/llmClient.js`, server process env | No |
| `VOICE_STT_API_KEY` / `VOICE_STT_URL` | `speech/providers/cloudSpeechProvider.js` | No |
| `VOICE_TTS_API_KEY` / `VOICE_TTS_URL` | `speech/providers/cloudSpeechProvider.js` | No |
| Per-project secrets (e.g. `STRIPE_SECRET_KEY`) | `workspaces/<id>/.env`, read server-side only | No |

The browser-side voice path (`web/voice.js`) uses the Web Speech API, which requires **no API key at all** — recognition and synthesis happen inside the browser itself. This is the only voice path that is actually exercised in this build; the `cloud` provider path is real code but requires operator-supplied credentials this environment doesn't have.

## Error handling — never fabricate success

- Cloud STT/TTS calls without configuration throw a descriptive `"... is not configured"` error rather than returning a fake transcript/audio. Verified by `tests/speechProviderAbstraction.test.js`.
- Audio-based language detection (`speech/language-detection.js::detectFromAudio`) explicitly returns `{ supported: false, reason: ... }` — there is no acoustic model in this codebase, and it does not pretend to have one.
- A project type with no implemented generator (Android, iOS, desktop, game, API, bot, AI agent) stops the pipeline with `status: generation_not_implemented` and a log entry saying so, rather than producing placeholder output labeled as real.
- Build/test steps only report `PASS` when the underlying process actually exited `0` — verified by inspecting real `stdout`/exit codes from `npm run build` / `npm test` in the integration test.

## Known gaps (stated, not hidden)

- No container/VM sandboxing (see Sandboxed execution above).
- No secrets vault/KMS — flat file with `0o600` permissions and `.gitignore`, adequate for local/single-node use, not for a multi-tenant production deployment.
- No rate limiting or auth on the API itself — this MVP assumes a trusted single user running it locally or behind their own access control. **This matters more now that the server binds `0.0.0.0` by default** (needed for real deployment reachability) rather than `127.0.0.1` — anyone who can reach the host on its port can reach the full API. Put a reverse proxy with auth in front for anything beyond trusted/local use.
- Per-project preview servers (`previewManager.js`) intentionally stay bound to `127.0.0.1` even though the main app binds `0.0.0.0` — see README's "Preview servers stay loopback-only" section.
- `cloudSpeechProvider.js` has not been exercised against a live third-party service in this environment (no network egress here) — its request-shaping code is real but untested end-to-end.
