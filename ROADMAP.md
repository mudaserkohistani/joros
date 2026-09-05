# Roadmap

Ordered roughly by what unlocks the most value next. Each item states what's missing today, honestly.

## 1. Browser-verified voice UX (next recommended upgrade)
`web/voice.js` is real code against the standard Web Speech API, and every piece of logic it depends on (state machine, language detection, command normalization, i18n) is unit- and integration-tested server-side. What has **not** happened is clicking the actual mic button in an actual browser — this environment has no browser. Next step: open `web/index.html` in Chrome/Edge, grant mic permission, and verify:
- the 🎤→🔴→🧠→🔊 state visuals actually match what the user sees
- live interim transcription renders as expected
- `SpeechRecognition`'s language auto-detection behavior (browsers vary — some do their own language ID, some require an exact `lang` tag) matches what `languageCode: "auto"` assumes server-side today

## 2. Expand the offline command dictionary
Right now `voice/commandNormalizer.js` covers exactly two intents (darker/lighter) in five languages, matching what `iterate.js` itself supports. As `iterate.js` grows more edit types (see #4), each new type needs phrase entries added per supported language — this is manual, linguistically-reviewed work, not something to auto-generate without a native speaker checking it.

## 3. More languages to `SUPPORTED`
Moving a language from `PARTIALLY_SUPPORTED` to `SUPPORTED` requires two concrete artifacts, not a flag flip:
- an `i18n/<code>.json` translation file (see the five existing ones for the exact key set)
- entries in `voice/commandNormalizer.js`'s dictionary for that language

Good next candidates given the registry: `tr`, `fr`, `es` (large practical user bases, Latin/well-understood scripts).

## 4. A real cloud STT/TTS provider, actually network-tested
`speech/providers/cloudSpeechProvider.js` is written against a generic HTTPS+JSON shape so it isn't locked to one vendor, but it has never been run against a live endpoint (this build environment has no network egress). Next step: configure `VOICE_STT_URL`/`VOICE_STT_API_KEY` (and TTS equivalents) against a real provider and run `tests/speechProviderAbstraction.test.js`-style checks against the live service, not just the "throws when unconfigured" path that's tested today.

## 5. Container/VM sandboxing
`server/lib/sandbox.js` is allowlist + path-jail + timeout, on the same kernel as the server process. For untrusted or multi-tenant use this needs a real isolation boundary (Docker/gVisor/Firecracker) underneath the existing allowlist, not instead of it.

## 6. Additional project-type generators
Android/iOS/desktop/game/API/bot/AI-agent are detected (`languages`... no — `projectTypeDetector.js`) but have no generator. Each is a real, separate scope of work (e.g. Android needs a working Gradle project + emulator or device build/test loop, not an HTML mockup labeled "Android"). See `docs/ARCHITECTURE.md`'s "Extending to new project types" section for the exact extension points.

## 7. Deployment integrations
No provider deploy integration exists at all today. Adding one (Vercel/Netlify/similar) should follow the same confirmation-gate pattern already built (`PUBLIC_DEPLOY` category in `confirmationPolicy.js`) rather than bypass it.

## 8. Multi-process-safe project store
`server/lib/db.js` is a JSON flat file. Fine for one server process; would need a real database (SQLite at minimum, Postgres for anything multi-instance) before running more than one JOROS server process against the same data.
