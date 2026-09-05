"use strict";
/**
 * Pure state machine for the voice UI. Kept dependency-free (no DOM) so it
 * can be required from both web/voice.js (in the browser) and from Node
 * tests — the exact same transition logic is what's tested and what runs.
 *
 * States: idle | listening | processing | speaking | error
 * Events: mic_pressed | transcript_final | mic_error | processing_done
 *         | speech_started | speech_ended | reset
 */

const STATES = ["idle", "listening", "processing", "speaking", "error"];

const TRANSITIONS = {
  idle: { mic_pressed: "listening" },
  listening: { transcript_final: "processing", mic_error: "error", reset: "idle" },
  processing: { processing_done: "speaking", processing_error: "error", no_speech_needed: "idle" },
  speaking: { speech_started: "speaking", speech_ended: "idle", speech_error: "error" },
  error: { reset: "idle", mic_pressed: "listening" }
};

/**
 * @param {string} currentState
 * @param {string} event
 * @returns {string} the next state (unchanged if the event isn't valid from currentState)
 */
function nextState(currentState, event) {
  const row = TRANSITIONS[currentState];
  if (!row || !row[event]) return currentState; // invalid transition: stay put, don't throw
  return row[event];
}

function isValidTransition(currentState, event) {
  const row = TRANSITIONS[currentState];
  return Boolean(row && row[event]);
}

const STATE_LABELS = {
  idle: "🎤 Ready",
  listening: "🔴 Listening",
  processing: "🧠 Processing",
  speaking: "🔊 Speaking",
  error: "❌ Error"
};

const API = { nextState, isValidTransition, STATES, STATE_LABELS };

// UMD-style export so the exact same tested logic can also be loaded
// directly in the browser via <script src="voiceStateMachine.js"> (no
// bundler) as window.JorosVoiceStateMachine, instead of duplicating the
// transition table client-side.
if (typeof module !== "undefined" && module.exports) {
  module.exports = API;
}
if (typeof window !== "undefined") {
  window.JorosVoiceStateMachine = API;
}
