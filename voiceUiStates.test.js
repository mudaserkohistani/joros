"use strict";
const assert = require("assert");
const { nextState, isValidTransition } = require("../voice/voiceStateMachine");

function run() {
  assert.strictEqual(nextState("idle", "mic_pressed"), "listening");
  assert.strictEqual(nextState("listening", "transcript_final"), "processing");
  assert.strictEqual(nextState("processing", "processing_done"), "speaking");
  assert.strictEqual(nextState("speaking", "speech_ended"), "idle");

  // Error paths
  assert.strictEqual(nextState("listening", "mic_error"), "error");
  assert.strictEqual(nextState("processing", "processing_error"), "error");
  assert.strictEqual(nextState("error", "reset"), "idle");
  assert.strictEqual(nextState("error", "mic_pressed"), "listening");

  // Invalid transitions must not change state (never throw, never guess)
  assert.strictEqual(nextState("idle", "speech_ended"), "idle");
  assert.strictEqual(isValidTransition("idle", "speech_ended"), false);
  assert.strictEqual(isValidTransition("idle", "mic_pressed"), true);

  console.log("PASS - voiceUiStates.test.js");
}

module.exports = { run };
if (require.main === module) run();
