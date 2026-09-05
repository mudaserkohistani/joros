"use strict";
const assert = require("assert");
const stt = require("../speech/speech-to-text");
const tts = require("../speech/text-to-speech");

async function run() {
  assert.deepStrictEqual(stt.listProviders().sort(), ["browser", "cloud"]);
  assert.deepStrictEqual(tts.listProviders().sort(), ["browser", "cloud"]);

  // Browser provider: delegated, never fabricates a transcript/audio.
  const browserStt = await stt.transcribe("browser", null, { languageCode: "en" });
  assert.strictEqual(browserStt.delegated, true);
  assert.strictEqual(browserStt.executesIn, "browser");
  assert.ok(!browserStt.text, "Browser provider must not return a fabricated transcript from the server");

  const browserTts = await tts.synthesize("browser", "hello", { languageCode: "en" });
  assert.strictEqual(browserTts.delegated, true);
  assert.ok(!browserTts.audioBase64, "Browser provider must not return fabricated audio from the server");

  // Cloud provider: must throw a clear, honest error when unconfigured
  // (test runs with no VOICE_STT_URL/VOICE_TTS_URL env vars set).
  delete process.env.VOICE_STT_URL;
  delete process.env.VOICE_STT_API_KEY;
  delete process.env.VOICE_TTS_URL;
  delete process.env.VOICE_TTS_API_KEY;

  let threw = false;
  try {
    await stt.transcribe("cloud", Buffer.from("fake"), {});
  } catch (err) {
    threw = true;
    assert.ok(/not configured/i.test(err.message), `Expected a "not configured" error, got: ${err.message}`);
  }
  assert.ok(threw, "Cloud STT must throw, not silently fabricate a transcript, when unconfigured");

  threw = false;
  try {
    await tts.synthesize("cloud", "hello", {});
  } catch (err) {
    threw = true;
    assert.ok(/not configured/i.test(err.message));
  }
  assert.ok(threw, "Cloud TTS must throw, not silently fabricate audio, when unconfigured");

  // Unknown provider name is rejected, not silently ignored.
  await assert.rejects(() => stt.transcribe("nonexistent", null, {}));

  console.log("PASS - speechProviderAbstraction.test.js");
}

module.exports = { run };
if (require.main === module) run().catch((e) => { console.error("FAIL -", e.message); process.exit(1); });
