"use strict";
/**
 * Voice pipeline: Microphone(browser) -> STT(browser) -> [this module:
 * language detection -> command normalization -> existing iterate.js edit
 * engine -> localized response text] -> TTS(browser).
 *
 * This module does not duplicate any project-modification logic — it
 * normalizes the instruction into the same canonical English string
 * server/lib/iterate.js already handles, then calls that unchanged.
 */
const languageDetection = require("../../speech/language-detection");
const commandNormalizer = require("../../voice/commandNormalizer");
const registry = require("../../languages/registry");
const i18n = require("../../i18n/i18n");
const iterate = require("./iterate");
const testRunner = require("./testRunner");
const db = require("./db");

/**
 * @param {string} projectId
 * @param {string} transcript  already-transcribed text (STT happened client-side)
 * @param {string} requestedLanguage  language code, or 'auto'
 */
async function handleVoiceCommand(projectId, transcript, requestedLanguage = "auto") {
  const project = db.getProject(projectId);
  if (!project) throw new Error("Unknown project");

  const detection =
    requestedLanguage === "auto" ? languageDetection.detectFromText(transcript) : { code: requestedLanguage, confidence: 1, method: "user_selected" };

  const languageCode = detection.code || "en";
  const langInfo = registry.getLanguage(languageCode) || registry.getLanguage("en");
  const strings = i18n.getStrings(languageCode);

  db.appendLog(projectId, {
    stage: "voice",
    message: `Voice command received. Detected language: ${languageCode} (confidence ${detection.confidence}, method: ${detection.method}).`
  });

  const normalized = commandNormalizer.normalize(transcript, requestedLanguage === "auto" ? "auto" : languageCode);

  if (!normalized.matched) {
    // Honesty fix: transcription succeeded (we have text) — it's the
    // command-intent match that failed, so this must NOT reuse the
    // "speech recognition failed" string, which would misreport what
    // actually happened. Only genuinely unsupported languages get the
    // unsupportedLanguage message; everything else gets a distinct,
    // accurate "didn't understand the command" message.
    const responseText = langInfo.tier === "SUPPORTED" ? strings.commandNotUnderstood : strings.unsupportedLanguage;
    db.appendLog(projectId, { stage: "voice", message: `Command not recognized by the offline normalizer for language "${languageCode}".` });
    return {
      recognizedLanguage: languageCode,
      direction: langInfo.direction,
      matched: false,
      responseText,
      appliedEdit: null
    };
  }

  db.appendLog(projectId, { stage: "voice", message: `Normalized instruction: "${normalized.canonical}" (from ${languageCode}).` });

  const editResult = await iterate.applyEdit(projectId, normalized.canonical);
  db.appendLog(projectId, {
    stage: "voice",
    message: editResult.applied ? `Applied: ${editResult.note}` : `Not applied: ${editResult.note}`
  });

  const testResult = await testRunner.runChecks(projectId);
  db.updateProject(projectId, { lastTestResult: testResult, status: testResult.ok ? "verified" : "failed_checks" });

  // Honest scope: only the "darker" canonical instruction has a fully
  // localized canned response string in i18n/. Other outcomes fall back to
  // the edit engine's own (English) note rather than pretending a
  // translation exists that wasn't written.
  let responseText = editResult.note;
  if (editResult.applied && testResult.ok && normalized.canonical === "make the homepage darker") {
    responseText = strings.responseHomepageDarkened;
  }

  return {
    recognizedLanguage: languageCode,
    direction: langInfo.direction,
    matched: true,
    canonicalInstruction: normalized.canonical,
    appliedEdit: editResult,
    testResult,
    responseText
  };
}

module.exports = { handleVoiceCommand };
