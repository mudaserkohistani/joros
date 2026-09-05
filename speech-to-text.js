"use strict";
/**
 * Speech-to-text provider abstraction.
 *
 * The core app calls transcribe(providerName, audioInput, options) and
 * never talks to a specific vendor directly, so swapping/adding providers
 * later doesn't touch calling code.
 *
 * Registered providers:
 *   - "browser": NOT executed server-side. The real transcription happens
 *     in the user's browser via the Web Speech API (see web/voice.js) —
 *     zero API keys, zero server dependency, works today. Calling this
 *     provider server-side returns a delegation notice, not a fake
 *     transcript.
 *   - "cloud": a real HTTPS-call-shaped provider (see providers/cloudSpeechProvider.js)
 *     that activates only if VOICE_STT_API_KEY + VOICE_STT_URL are
 *     configured. In this build's environment (no network egress) it has
 *     not been exercised against a live service — calling it without
 *     configuration throws a clear, honest error rather than fabricating
 *     a transcript.
 */
const browserDelegate = require("./providers/browserDelegateProvider");
const cloudProvider = require("./providers/cloudSpeechProvider");

const PROVIDERS = {
  browser: browserDelegate.stt,
  cloud: cloudProvider.stt
};

function listProviders() {
  return Object.keys(PROVIDERS);
}

/**
 * @param {string} providerName
 * @param {Buffer|null} audioInput  raw audio bytes, or null for the
 *   "browser" provider (which never sends audio to the server)
 * @param {{languageCode?: string}} options
 */
async function transcribe(providerName, audioInput, options = {}) {
  const provider = PROVIDERS[providerName];
  if (!provider) {
    throw new Error(`Unknown STT provider "${providerName}". Available: ${listProviders().join(", ")}`);
  }
  return provider.transcribe(audioInput, options);
}

module.exports = { transcribe, listProviders };
