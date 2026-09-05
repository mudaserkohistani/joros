"use strict";
const assert = require("assert");
const i18n = require("../i18n/i18n");

function run() {
  const locales = i18n.availableLocales();
  for (const code of ["en", "fa", "ps", "de", "ar"]) {
    assert.ok(locales.includes(code), `Expected locale file for ${code}`);
  }

  const en = i18n.getStrings("en");
  assert.strictEqual(en.appTitle, "JOROS");
  assert.ok(en.voiceUnavailableOffline);

  const fa = i18n.getStrings("fa");
  assert.notStrictEqual(fa.appTitle, en.appTitle === undefined);
  assert.ok(fa.micListening.includes("🔴"));

  // Missing locale falls back to English with an explicit marker, not silently.
  const missing = i18n.getStrings("sw"); // Swahili not in our i18n set
  assert.strictEqual(missing._fallback, true);
  assert.strictEqual(missing.appTitle, en.appTitle);

  console.log("PASS - i18n.test.js");
}

module.exports = { run };
if (require.main === module) run();
