"use strict";
/**
 * Runs every test module in this directory. Plain Node + built-in
 * `assert` — no test framework dependency (none can be installed in this
 * network-restricted environment, and none is needed for this suite's
 * size).
 */
const path = require("path");

const SYNC_TESTS = [
  "languageRegistry.test.js",
  "languageDetection.test.js",
  "i18n.test.js",
  "commandNormalizer.test.js",
  "voiceUiStates.test.js"
];

const ASYNC_TESTS = ["speechProviderAbstraction.test.js", "integration.voice.test.js"];

async function main() {
  let failures = 0;
  const results = [];

  for (const file of SYNC_TESTS) {
    try {
      require(path.join(__dirname, file)).run();
      results.push({ file, ok: true });
    } catch (err) {
      failures++;
      results.push({ file, ok: false, error: err.message });
      console.error(`FAIL - ${file}: ${err.message}`);
    }
  }

  for (const file of ASYNC_TESTS) {
    try {
      await require(path.join(__dirname, file)).run();
      results.push({ file, ok: true });
    } catch (err) {
      failures++;
      results.push({ file, ok: false, error: err.message });
      console.error(`FAIL - ${file}: ${err.message}`);
    }
  }

  console.log("\n=== Summary ===");
  for (const r of results) console.log(`${r.ok ? "PASS" : "FAIL"} - ${r.file}`);
  console.log(`${results.length - failures}/${results.length} passed`);

  process.exit(failures > 0 ? 1 : 0);
}

main();
