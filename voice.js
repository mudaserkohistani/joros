"use strict";
/**
 * Real, working voice UI built on the browser's native Web Speech API
 * (SpeechRecognition for input, speechSynthesis for output). No API key,
 * no server audio round-trip, works today in supporting browsers
 * (Chrome/Edge; Firefox/Safari support varies -- reported honestly via
 * error states, not assumed).
 *
 * State transitions are driven by the SAME state machine module that
 * tests/voiceUiStates.test.js verifies (voice/voiceStateMachine.js),
 * loaded here as window.JorosVoiceStateMachine via /shared/voiceStateMachine.js.
 */

const SM = window.JorosVoiceStateMachine;
let voiceState = "idle";
let currentLanguageCode = "auto";
let currentUiStrings = null;
let recognition = null;

const micBtn = document.getElementById("mic-btn");
const micStateEl = document.getElementById("mic-state");
const transcriptEl = document.getElementById("voice-transcript");
const responseEl = document.getElementById("voice-response");
const languageSelect = document.getElementById("language-select");
const responseLanguageSelect = document.getElementById("response-language-select");
const voiceEnabledToggle = document.getElementById("voice-enabled-toggle");
const speechSpeedInput = document.getElementById("speech-speed");

function setVoiceState(newState) {
  voiceState = newState;
  micStateEl.textContent = SM.STATE_LABELS[newState];
  micBtn.className = "mic-button " + (newState === "idle" || newState === "error" ? "" : newState);
}

function applyEvent(event) {
  const next = SM.nextState(voiceState, event);
  setVoiceState(next);
  return next;
}

async function loadLanguages() {
  try {
    const res = await fetch("/api/languages");
    const data = await res.json();
    populateLanguageSelects(data.languages);
  } catch (err) {
    console.error("Could not load language list:", err);
  }
}

function populateLanguageSelects(languages) {
  const tierLabel = { SUPPORTED: "\u2713", PARTIALLY_SUPPORTED: "~", NOT_AVAILABLE: "\u2717" };
  const selects = [languageSelect, responseLanguageSelect];
  for (let i = 0; i < selects.length; i++) {
    const select = selects[i];
    const keepFirst = select.options[0];
    select.innerHTML = "";
    select.appendChild(keepFirst);
    for (const lang of languages) {
      const opt = document.createElement("option");
      opt.value = lang.code;
      opt.textContent = (tierLabel[lang.tier] || "") + " " + lang.native + " (" + lang.name + ")";
      select.appendChild(opt);
    }
  }
}

async function applyLanguage(code) {
  currentLanguageCode = code;
  const effectiveCode = code === "auto" ? "en" : code;
  const res = await fetch("/api/i18n/" + effectiveCode);
  const data = await res.json();
  currentUiStrings = data.strings;
  applyUiStrings(data.strings);

  const RTL = new Set(["fa", "ps", "ar", "ur", "he"]);
  document.body.dir = RTL.has(effectiveCode) ? "rtl" : "ltr";
}

function applyUiStrings(strings) {
  const map = {
    "app-title": strings.appTitle,
    "voice-settings-heading": strings.voiceSettingsHeading,
    "voice-enabled-label": strings.voiceEnabledLabel,
    "response-language-label": strings.responseLanguageLabel,
    "speech-speed-label": strings.speechSpeedLabel
  };
  for (const id in map) {
    const el = document.getElementById(id);
    if (el && map[id]) el.textContent = map[id];
  }
  const composerHeading = document.querySelector("#composer h2");
  if (composerHeading && strings.composerHeading) composerHeading.textContent = strings.composerHeading;
  const buildBtn = document.getElementById("build-btn");
  if (buildBtn && strings.buildButton) buildBtn.textContent = strings.buildButton;
  setVoiceState(voiceState);
}

languageSelect.addEventListener("change", function (e) { applyLanguage(e.target.value); });

function getSpeechRecognitionCtor() {
  return window.SpeechRecognition || window.webkitSpeechRecognition || null;
}

function bcp47For(code) {
  const MAP = { fa: "fa-IR", ps: "ps-AF", en: "en-US", ar: "ar-SA", de: "de-DE" };
  return MAP[code] || "en-US";
}

function startListening() {
  if (!voiceEnabledToggle.checked) return;
  const Ctor = getSpeechRecognitionCtor();
  if (!Ctor) {
    transcriptEl.textContent = (currentUiStrings && currentUiStrings.unsupportedBrowser) || "This browser does not support voice input.";
    applyEvent("mic_error");
    return;
  }
  if (!window.JorosState || !window.JorosState.currentProjectId) {
    transcriptEl.textContent = "Build or open a project first, then use voice commands to modify it.";
    return;
  }

  recognition = new Ctor();
  recognition.lang = currentLanguageCode === "auto" ? "" : bcp47For(currentLanguageCode);
  recognition.interimResults = true;
  recognition.continuous = false;

  applyEvent("mic_pressed");
  transcriptEl.textContent = "";
  responseEl.textContent = "";

  recognition.onresult = function (event) {
    let interim = "";
    let final = "";
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const chunk = event.results[i][0].transcript;
      if (event.results[i].isFinal) final += chunk;
      else interim += chunk;
    }
    transcriptEl.textContent = final || interim;
    if (final) handleFinalTranscript(final.trim());
  };

  recognition.onerror = function (event) {
    const strings = currentUiStrings || {};
    if (event.error === "not-allowed" || event.error === "permission-denied") {
      transcriptEl.textContent = strings.micPermissionDenied || "Microphone permission was denied.";
    } else if (event.error === "network") {
      transcriptEl.textContent = strings.networkFailure || "A network error occurred.";
    } else {
      transcriptEl.textContent = (strings.transcriptionFailed || "Speech recognition failed.") + " (" + event.error + ")";
    }
    applyEvent("mic_error");
  };

  recognition.onend = function () {
    if (voiceState === "listening") applyEvent("reset");
  };

  try {
    recognition.start();
  } catch (err) {
    transcriptEl.textContent = "Could not start speech recognition: " + err.message;
    applyEvent("mic_error");
  }
}

async function handleFinalTranscript(text) {
  applyEvent("transcript_final");
  const projectId = window.JorosState.currentProjectId;
  try {
    const res = await fetch("/api/projects/" + projectId + "/voice-message", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ transcript: text, languageCode: currentLanguageCode })
    });
    const body = await res.json();
    if (!res.ok) throw new Error(body.error || "Voice command failed");

    applyEvent("processing_done");
    responseEl.textContent = body.responseText;
    document.body.dir = body.direction || document.body.dir;

    if (window.JorosRefreshProject) await window.JorosRefreshProject();

    speak(body.responseText, body.recognizedLanguage);
  } catch (err) {
    responseEl.textContent = "Error: " + err.message;
    applyEvent("processing_error");
  }
}

function speak(text, languageCode) {
  if (!voiceEnabledToggle.checked) {
    applyEvent("no_speech_needed");
    return;
  }
  if (!("speechSynthesis" in window)) {
    responseEl.textContent += " " + ((currentUiStrings && currentUiStrings.synthesisFailed) || "Could not generate speech for the response.");
    applyEvent("no_speech_needed");
    return;
  }
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = bcp47For(languageCode);
  utterance.rate = parseFloat(speechSpeedInput.value) || 1.0;
  utterance.onstart = function () { applyEvent("speech_started"); };
  utterance.onend = function () { applyEvent("speech_ended"); };
  utterance.onerror = function () { applyEvent("speech_error"); };
  window.speechSynthesis.speak(utterance);
}

micBtn.addEventListener("click", function () {
  if (voiceState === "idle" || voiceState === "error") {
    startListening();
  } else if (voiceState === "listening" && recognition) {
    recognition.stop();
    applyEvent("reset");
  }
});

setVoiceState("idle");
loadLanguages();
applyLanguage("auto");
