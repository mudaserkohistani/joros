"use strict";
const assert = require("assert");
const { detectFromText, detectFromAudio } = require("../speech/language-detection");

function run() {
  // Exact example phrases from the spec.
  const fa = detectFromText("یک وب‌سایت رستوران بساز");
  assert.strictEqual(fa.code, "fa", `Expected Dari/Persian, got ${fa.code}`);

  const ps = detectFromText("یک ویب سایت د رستورانت لپاره جوړ کړه");
  assert.strictEqual(ps.code, "ps", `Expected Pashto, got ${ps.code}`);

  const en = detectFromText("Build me a restaurant website");
  assert.strictEqual(en.code, "en", `Expected English, got ${en.code}`);

  // Additional script sanity checks
  assert.strictEqual(detectFromText("Ich möchte eine Webseite bauen").code, "de");
  assert.strictEqual(detectFromText("مرحبا بكم في موقعنا").code, "ar");
  assert.strictEqual(detectFromText("привет как дела").code, "ru");
  assert.strictEqual(detectFromText("こんにちは").code, "ja");
  assert.strictEqual(detectFromText("你好世界").code, "zh");
  assert.strictEqual(detectFromText("안녕하세요").code, "ko");
  assert.strictEqual(detectFromText("नमस्ते दुनिया").code, "hi");

  assert.deepStrictEqual(detectFromText(""), { code: null, confidence: 0, method: "empty_input" });

  const audio = detectFromAudio();
  assert.strictEqual(audio.supported, false, "Audio detection must honestly report unavailability, not fake a result");

  console.log("PASS - languageDetection.test.js");
}

module.exports = { run };
if (require.main === module) run();
