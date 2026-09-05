"use strict";
/**
 * Generic cloud speech provider.
 *
 * This is written provider-agnostically (configurable endpoint URL) rather
 * than hard-coded to one vendor, per the "provider abstraction" requirement.
 * It is REAL code — a genuine HTTPS POST using Node's built-in https module,
 * same pattern as server/lib/llmClient.js — but it is inert until an
 * operator configures:
 *
 *   VOICE_STT_URL, VOICE_STT_API_KEY   (speech-to-text endpoint)
 *   VOICE_TTS_URL, VOICE_TTS_API_KEY   (text-to-speech endpoint)
 *
 * In this build's environment there is no outbound network access, so this
 * path has NOT been exercised against a live service. Calling it without
 * configuration throws a clear, honest error. Calling it with configuration
 * but without network access will surface a real connection error, not a
 * fabricated result.
 *
 * SECURITY: API keys are read from process.env only, sent only in a
 * request header to the configured URL, and never included in any return
 * value, thrown error message, or log line.
 */
const https = require("https");
const { URL } = require("url");

function isConfigured(kind) {
  if (kind === "stt") return Boolean(process.env.VOICE_STT_URL && process.env.VOICE_STT_API_KEY);
  if (kind === "tts") return Boolean(process.env.VOICE_TTS_URL && process.env.VOICE_TTS_API_KEY);
  return false;
}

function postJson(urlStr, apiKey, payload) {
  return new Promise((resolve, reject) => {
    let parsed;
    try {
      parsed = new URL(urlStr);
    } catch {
      reject(new Error("Configured voice provider URL is invalid."));
      return;
    }
    const body = JSON.stringify(payload);
    const req = https.request(
      {
        hostname: parsed.hostname,
        path: parsed.pathname + parsed.search,
        port: parsed.port || 443,
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${apiKey}`,
          "content-length": Buffer.byteLength(body)
        },
        timeout: 30_000
      },
      (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => {
          if (res.statusCode < 200 || res.statusCode >= 300) {
            // Deliberately do not include response body verbatim in case a
            // misconfigured echo endpoint reflects the auth header back.
            reject(new Error(`Voice provider returned HTTP ${res.statusCode}`));
            return;
          }
          try {
            resolve(JSON.parse(data));
          } catch {
            reject(new Error("Voice provider returned a non-JSON response."));
          }
        });
      }
    );
    req.on("timeout", () => req.destroy(new Error("Voice provider request timed out")));
    req.on("error", () => reject(new Error("Voice provider request failed (network error).")));
    req.write(body);
    req.end();
  });
}

async function transcribe(audioInput, options = {}) {
  if (!isConfigured("stt")) {
    throw new Error(
      "Cloud STT provider is not configured. Set VOICE_STT_URL and VOICE_STT_API_KEY server-side to enable it. Use the 'browser' provider for zero-configuration speech recognition."
    );
  }
  if (!audioInput) throw new Error("No audio provided to transcribe.");
  const result = await postJson(process.env.VOICE_STT_URL, process.env.VOICE_STT_API_KEY, {
    audioBase64: audioInput.toString("base64"),
    languageCode: options.languageCode || "auto"
  });
  return { delegated: false, executesIn: "cloud", text: result.text, detectedLanguage: result.detectedLanguage };
}

async function synthesize(text, options = {}) {
  if (!isConfigured("tts")) {
    throw new Error(
      "Cloud TTS provider is not configured. Set VOICE_TTS_URL and VOICE_TTS_API_KEY server-side to enable it. Use the 'browser' provider for zero-configuration speech synthesis."
    );
  }
  const result = await postJson(process.env.VOICE_TTS_URL, process.env.VOICE_TTS_API_KEY, {
    text,
    languageCode: options.languageCode || "en",
    speed: options.speed || 1.0,
    voice: options.voice
  });
  return { delegated: false, executesIn: "cloud", audioBase64: result.audioBase64, mimeType: result.mimeType };
}

module.exports = { stt: { transcribe, isConfigured: () => isConfigured("stt") }, tts: { synthesize, isConfigured: () => isConfigured("tts") } };
