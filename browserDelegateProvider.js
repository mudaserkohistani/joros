"use strict";
/**
 * The "browser" provider does its real work in web/voice.js using the
 * standard Web Speech API (SpeechRecognition + SpeechSynthesis) — no API
 * key, no server round-trip for audio, and it genuinely works in
 * supporting browsers today. These server-side functions exist only to
 * satisfy the provider interface uniformly; they must never claim to have
 * transcribed or synthesized anything themselves, since they didn't.
 */

async function transcribe() {
  return {
    delegated: true,
    executesIn: "browser",
    note: "Transcription for the 'browser' provider happens client-side via the Web Speech API (SpeechRecognition). The server does not receive or process audio for this provider — it only receives the resulting text."
  };
}

async function synthesize() {
  return {
    delegated: true,
    executesIn: "browser",
    note: "Synthesis for the 'browser' provider happens client-side via window.speechSynthesis. The server does not generate audio bytes for this provider."
  };
}

module.exports = { stt: { transcribe }, tts: { synthesize } };
