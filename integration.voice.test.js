"use strict";
const assert = require("assert");
const http = require("http");
const { spawn } = require("child_process");
const path = require("path");

const PORT = 4791;
const BASE = `http://127.0.0.1:${PORT}`;

function request(method, urlPath, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const req = http.request(
      BASE + urlPath,
      {
        method,
        headers: { "content-type": "application/json", ...(data ? { "content-length": Buffer.byteLength(data) } : {}) }
      },
      (res) => {
        let raw = "";
        res.on("data", (c) => (raw += c));
        res.on("end", () => {
          try {
            resolve({ status: res.statusCode, body: JSON.parse(raw), raw });
          } catch {
            resolve({ status: res.statusCode, body: null, raw });
          }
        });
      }
    );
    req.on("error", reject);
    if (data) req.write(data);
    req.end();
  });
}

function waitForServer(retries = 30) {
  return new Promise((resolve, reject) => {
    const attempt = (n) => {
      http
        .get(BASE + "/api/system/status", (res) => {
          res.resume();
          resolve();
        })
        .on("error", () => {
          if (n <= 0) return reject(new Error("Server did not start in time"));
          setTimeout(() => attempt(n - 1), 200);
        });
    };
    attempt(retries);
  });
}

async function run() {
  const serverPath = path.join(__dirname, "..", "server", "index.js");
  const child = spawn("node", [serverPath], {
    env: { ...process.env, PORT: String(PORT) },
    stdio: ["ignore", "pipe", "pipe"]
  });
  let stdout = "";
  child.stdout.on("data", (d) => (stdout += d));

  try {
    await waitForServer();

    // --- Offline fallback: voice status must honestly report offline mode ---
    const voiceStatus = await request("GET", "/api/voice/status");
    assert.strictEqual(voiceStatus.status, 200);
    assert.strictEqual(voiceStatus.body.offlineMode, true, "No cloud voice provider is configured in this test run, so offlineMode must be true");
    assert.strictEqual(voiceStatus.body.browserProvider.available, true);
    assert.strictEqual(voiceStatus.body.cloudProvider.sttConfigured, false);

    // --- Languages endpoint ---
    const langs = await request("GET", "/api/languages");
    assert.strictEqual(langs.status, 200);
    assert.strictEqual(langs.body.languages.length, 30);
    const faEntry = langs.body.languages.find((l) => l.code === "fa");
    assert.strictEqual(faEntry.tier, "SUPPORTED");
    assert.strictEqual(faEntry.direction, "rtl");

    // --- i18n endpoint ---
    const faStrings = await request("GET", "/api/i18n/fa");
    assert.strictEqual(faStrings.status, 200);
    assert.strictEqual(faStrings.body.strings.appTitle, "جوروس");

    // --- Language detection endpoint (real, no network needed) ---
    const detect = await request("POST", "/api/voice/detect-language", { text: "یک وب‌سایت رستوران بساز" });
    assert.strictEqual(detect.body.code, "fa");

    // --- TTS without config must fail cleanly, not fabricate audio ---
    const ttsAttempt = await request("POST", "/api/voice/synthesize", { text: "hello", provider: "cloud" });
    assert.strictEqual(ttsAttempt.status, 503);
    assert.ok(/not configured/i.test(ttsAttempt.body.error));
    assert.ok(!ttsAttempt.body.audioBase64, "Must not return fabricated audio");

    // --- Build a real project, then drive it entirely via a Persian voice command ---
    const created = await request("POST", "/api/projects", { message: "Build me a modern restaurant website with a menu and contact page." });
    assert.strictEqual(created.status, 201);
    const projectId = created.body.id;
    assert.strictEqual(created.body.status, "verified", `Expected project to build and verify, got status: ${created.body.status}`);

    const cssBefore = await request("GET", `/api/projects/${projectId}/files/styles.css`);
    assert.ok(cssBefore.raw.includes("--bg: #faf7f2;"), "Expected default (light) background before the voice edit");

    const voiceResult = await request("POST", `/api/projects/${projectId}/voice-message`, {
      transcript: "صفحه اصلی را تاریک‌تر کن.",
      languageCode: "auto"
    });
    assert.strictEqual(voiceResult.status, 200);
    assert.strictEqual(voiceResult.body.recognizedLanguage, "fa");
    assert.strictEqual(voiceResult.body.direction, "rtl");
    assert.strictEqual(voiceResult.body.matched, true);
    assert.strictEqual(voiceResult.body.appliedEdit.applied, true);
    assert.strictEqual(voiceResult.body.responseText, "انجام شد. تم صفحه اصلی را تغییر دادم و پروژه را بررسی کردم.");

    const cssAfter = await request("GET", `/api/projects/${projectId}/files/styles.css`);
    assert.ok(cssAfter.raw.includes("--bg: #1c1a17;"), "Voice command should have actually darkened the CSS, same as the text-based iterate path");

    // --- Honesty check: an unmatched command must NOT be reported as a
    // transcription failure (transcription succeeded — the intent just
    // wasn't recognized). Regression test for a bug found during manual
    // verification. ---
    const unmatched = await request("POST", `/api/projects/${projectId}/voice-message`, {
      transcript: "please rearrange the entire database schema",
      languageCode: "en"
    });
    assert.strictEqual(unmatched.body.matched, false);
    assert.notStrictEqual(unmatched.body.responseText, "Speech recognition failed. Please try again.");
    assert.strictEqual(unmatched.body.responseText, "I heard you, but I don't recognize that as a command I can act on yet.");

    // --- Security: secret set via API must never be echoed back anywhere ---
    const setSecret = await request("POST", `/api/projects/${projectId}/secrets`, { key: "STRIPE_SECRET_KEY", value: "sk_test_should_never_leak_ABC123" });
    assert.strictEqual(setSecret.status, 200);
    assert.ok(!("value" in setSecret.body), "Secret endpoint must not echo the value back");

    const projectAfter = await request("GET", `/api/projects/${projectId}`);
    const fullDump = JSON.stringify(projectAfter.body);
    assert.ok(!fullDump.includes("sk_test_should_never_leak_ABC123"), "Secret value must never appear anywhere in the project's API representation (log, plan, etc.)");

    const secretsStatus = await request("GET", `/api/projects/${projectId}/secrets`);
    const secretsDump = JSON.stringify(secretsStatus.body);
    assert.ok(!secretsDump.includes("sk_test_should_never_leak_ABC123"), "Secrets status endpoint must never include the raw value");

    console.log("PASS - integration.voice.test.js");
  } finally {
    child.kill("SIGKILL");
  }
}

module.exports = { run };
if (require.main === module) {
  run().catch((e) => {
    console.error("FAIL -", e.message);
    process.exit(1);
  });
}
