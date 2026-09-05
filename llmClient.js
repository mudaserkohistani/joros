"use strict";
/**
 * Anthropic API client, implemented on Node's built-in `https` module so it
 * requires zero external dependencies.
 *
 * Honesty note: in the sandbox this project was built in, there is no
 * outbound network access, so this client's `available()` check will
 * report false and every caller falls back to the deterministic template
 * generator (see codeGenAgent.js). The code path below is real and will
 * make a genuine API call when ANTHROPIC_API_KEY is set and the process has
 * network access — it has not been exercised end-to-end against the live
 * API in this environment, and JOROS's own UI says so (see
 * GET /api/system/status) rather than silently claiming LLM generation
 * happened when it didn't.
 */
const https = require("https");

const MODEL = "claude-sonnet-4-6";
const API_HOST = "api.anthropic.com";
const API_VERSION = "2023-06-01";

function hasApiKey() {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

/**
 * @param {string} systemPrompt
 * @param {string} userPrompt
 * @param {number} maxTokens
 * @returns {Promise<string>} the model's text response
 */
function complete(systemPrompt, userPrompt, maxTokens = 4096) {
  return new Promise((resolve, reject) => {
    if (!hasApiKey()) {
      reject(new Error("ANTHROPIC_API_KEY not configured — LLM generation unavailable, use offline fallback"));
      return;
    }

    const payload = JSON.stringify({
      model: MODEL,
      max_tokens: maxTokens,
      system: systemPrompt,
      messages: [{ role: "user", content: userPrompt }]
    });

    const req = https.request(
      {
        hostname: API_HOST,
        path: "/v1/messages",
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": process.env.ANTHROPIC_API_KEY,
          "anthropic-version": API_VERSION,
          "content-length": Buffer.byteLength(payload)
        },
        timeout: 60_000
      },
      (res) => {
        let body = "";
        res.on("data", (chunk) => (body += chunk));
        res.on("end", () => {
          if (res.statusCode < 200 || res.statusCode >= 300) {
            reject(new Error(`Anthropic API error ${res.statusCode}: ${body.slice(0, 500)}`));
            return;
          }
          try {
            const parsed = JSON.parse(body);
            const text = (parsed.content || [])
              .filter((b) => b.type === "text")
              .map((b) => b.text)
              .join("\n");
            resolve(text);
          } catch (err) {
            reject(new Error(`Failed to parse Anthropic response: ${err.message}`));
          }
        });
      }
    );

    req.on("timeout", () => req.destroy(new Error("Anthropic API request timed out")));
    req.on("error", reject);
    req.write(payload);
    req.end();
  });
}

module.exports = { complete, hasApiKey, MODEL };
