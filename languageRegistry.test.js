"use strict";
const assert = require("assert");
const registry = require("../languages/registry");

function run() {
  const langs = registry.listLanguages();
  assert.strictEqual(langs.length, 30, `Expected 30 registered languages, got ${langs.length}`);

  for (const code of ["en", "fa", "ps", "de", "ar"]) {
    const lang = registry.getLanguage(code);
    assert.strictEqual(lang.tier, "SUPPORTED", `${code} should be SUPPORTED (has i18n + command dictionary)`);
  }

  const partial = registry.getLanguage("fr");
  assert.strictEqual(partial.tier, "PARTIALLY_SUPPORTED", "fr has no i18n/command dictionary yet, should be PARTIALLY_SUPPORTED");

  assert.strictEqual(registry.getLanguage("xx"), null, "Unknown code should return null");

  // RTL set
  for (const code of ["fa", "ps", "ar", "ur", "he"]) {
    assert.strictEqual(registry.getLanguage(code).direction, "rtl", `${code} should be rtl`);
  }
  for (const code of ["en", "de", "fr", "zh", "ja"]) {
    assert.strictEqual(registry.getLanguage(code).direction, "ltr", `${code} should be ltr`);
  }

  console.log("PASS - languageRegistry.test.js");
}

module.exports = { run };
if (require.main === module) run();
