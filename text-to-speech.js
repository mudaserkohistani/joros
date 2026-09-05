"use strict";
/**
 * Text-to-speech provider abstraction. Mirrors speech-to-text.js.
 *
 *   - "browser": real synthesis happens client-side via
 *     window.speechSynthesis (see web/voice.js). No server audio work.
 *   - "cloud": real HTTPS-call-shaped provider, inert without
 *     VOICE_TTS_API_KEY + VOICE_TTS_URL configured, environment-dependent.
 */
const browserDelegate = require("./providers/browserDelegateProvider");
const cloudProvider = require("./providers/cloudSpeechProvider");

const PROVIDERS = {
  browser: browserDelegate.tts,
  cloud: cloudProvider.tts
};

function listProviders() {
  return Object.keys(PROVIDERS);
}

/**
 * @param {string} providerName
 * @param {string} text
 * @param {{languageCode?: string, speed?: number, voice?: string}} options
 */
async function synthesize(providerName, text, options = {}) {
  const provider = PROVIDERS[providerName];
  if (!provider) {
    throw new Error(`Unknown TTS provider "${providerName}". Available: ${listProviders().join(", ")}`);
  }
  return provider.synthesize(text, options);
}

module.exports = { synthesize, listProviders };
