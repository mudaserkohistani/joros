"use strict";
const assert = require("assert");
const { normalize } = require("../voice/commandNormalizer");

function run() {
  const en = normalize("Make the homepage darker.", "en");
  assert.strictEqual(en.matched, true);
  assert.strictEqual(en.canonical, "make the homepage darker");

  const fa = normalize("صفحه اصلی را تاریک‌تر کن.", "fa");
  assert.strictEqual(fa.matched, true);
  assert.strictEqual(fa.canonical, "make the homepage darker");

  const ps = normalize("د اصلي پاڼې رنګونه تیاره کړه.", "ps");
  assert.strictEqual(ps.matched, true);
  assert.strictEqual(ps.canonical, "make the homepage darker");

  const de = normalize("mach die startseite dunkler", "de");
  assert.strictEqual(de.matched, true);

  const ar = normalize("اجعل الصفحة الرئيسية أغمق", "ar");
  assert.strictEqual(ar.matched, true);

  // auto mode should find it without knowing the language in advance
  const auto = normalize("صفحه اصلی را تاریک‌تر کن.", "auto");
  assert.strictEqual(auto.matched, true);
  assert.strictEqual(auto.languageCode, "fa");

  // Unrecognized command must be reported as unmatched, not guessed.
  const unknown = normalize("do something completely unrelated to styling", "en");
  assert.strictEqual(unknown.matched, false);

  console.log("PASS - commandNormalizer.test.js");
}

module.exports = { run };
if (require.main === module) run();
