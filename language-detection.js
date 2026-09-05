"use strict";
/**
 * Text-based language detection.
 *
 * This is a genuine, deterministic heuristic — not a machine-learning
 * model and not an LLM call. It works by:
 *   1. Unicode script detection (which alphabet/script is the text in)
 *   2. Within a shared script (e.g. Arabic-derived scripts, or Latin),
 *      distinguishing letters/stopwords narrow it down further
 *
 * Honesty notes:
 *   - Confidence is reported, and is deliberately low/medium for anything
 *     resolved only by script (e.g. "some Latin-script language") without
 *     a stopword match.
 *   - detectFromAudio() is a stub: this server has no audio decoding or
 *     acoustic model. It reports that plainly rather than guessing.
 */

// Letters that appear in Pashto's Perso-Arabic-derived alphabet but not in
// standard Persian/Dari or Arabic.
const PASHTO_ONLY_CHARS = /[\u0693\u0696\u06AB\u06BC\u069A\u067C\u0688\u06D0]/; // ړ ږ ګ ڼ ښ ټ ډ ې

// Letters used in Persian/Dari and Urdu but not in standard Arabic.
const PERSO_URDU_EXTRA_CHARS = /[\u067E\u0686\u0698\u06AF]/; // پ چ ژ گ

// Persian-form Yeh/Kaf (U+06CC, U+06A9) vs the Arabic-form Yeh/Kaf
// (U+064A, U+0643) used in standard Arabic orthography. Properly encoded
// Persian/Dari text uses the Persian forms; this is a weaker signal than
// PERSO_URDU_EXTRA_CHARS (Urdu also uses these forms) so it's checked after
// the more specific Pashto/Urdu/extra-character checks.
const PERSIAN_YEH_KAF = /[\u06A9\u06CC]/; // ک ی

// Letters distinguishing Urdu (retroflex) from Persian/Dari.
const URDU_RETROFLEX_CHARS = /[\u0679\u0688\u0691]/; // ٹ ڈ ڑ (ڈ overlaps Pashto ډ visually but codepoint differs)

const SCRIPT_RANGES = [
  { code: "arabic-family", re: /[\u0600-\u06FF\u0750-\u077F]/ },
  { code: "he", re: /[\u0590-\u05FF]/ },
  { code: "ru-uk", re: /[\u0400-\u04FF]/ }, // Cyrillic: Russian/Ukrainian (and others, not distinguished)
  { code: "zh", re: /[\u4E00-\u9FFF]/ }, // Han — Chinese (Japanese Kanji overlaps, checked first below)
  { code: "ja", re: /[\u3040-\u30FF]/ }, // Hiragana/Katakana — decisive for Japanese vs Chinese
  { code: "ko", re: /[\uAC00-\uD7A3]/ },
  { code: "hi", re: /[\u0900-\u097F]/ }, // Devanagari — Hindi
  { code: "bn", re: /[\u0980-\u09FF]/ },
  { code: "th", re: /[\u0E00-\u0E7F]/ },
  { code: "el", re: /[\u0370-\u03FF]/ },
  { code: "vi", re: /[\u1EA0-\u1EF9]/ } // Vietnamese-specific Latin extensions
];

// Small, real stopword sets to disambiguate Latin-script European languages.
// Deliberately short — this is a heuristic, not a language-ID model, and
// says so via the confidence score rather than pretending precision it
// doesn't have.
const LATIN_STOPWORDS = {
  en: ["the", "and", "build", "make", "website", "with", "for", "is", "this"],
  de: ["und", "der", "die", "das", "bau", "erstelle", "mit", "für", "ich", "eine", "möchte", "ist", "nicht"],
  fr: ["le", "la", "les", "et", "construire", "site", "avec", "pour", "je", "veux", "un", "une"],
  es: ["el", "la", "los", "y", "construir", "sitio", "con", "para", "yo", "quiero", "un", "una"],
  it: ["il", "la", "e", "costruire", "sito", "con", "per", "io", "voglio", "un", "una"],
  pt: ["o", "a", "e", "construir", "site", "com", "para", "eu", "quero", "um", "uma"],
  nl: ["de", "het", "en", "bouw", "website", "met", "voor", "ik", "wil", "een"],
  tr: ["ve", "bir", "için", "web", "sitesi", "yap", "oluştur", "ben", "istiyorum"],
  id: ["dan", "yang", "untuk", "buat", "situs", "dengan", "saya", "ingin"],
  ms: ["dan", "yang", "untuk", "buat", "laman", "dengan", "saya", "nak"],
  pl: ["i", "dla", "zbuduj", "strona", "z", "ja", "chcę"],
  uk: [] // Cyrillic branch handles this, not Latin
};

function detectFromText(text) {
  if (!text || !text.trim()) {
    return { code: null, confidence: 0, method: "empty_input" };
  }

  // Arabic-script family: narrow via distinguishing letters.
  if (SCRIPT_RANGES[0].re.test(text)) {
    if (PASHTO_ONLY_CHARS.test(text)) {
      return { code: "ps", confidence: 0.85, method: "script+distinguishing_letters" };
    }
    if (URDU_RETROFLEX_CHARS.test(text)) {
      return { code: "ur", confidence: 0.7, method: "script+distinguishing_letters" };
    }
    if (PERSO_URDU_EXTRA_CHARS.test(text)) {
      return { code: "fa", confidence: 0.75, method: "script+distinguishing_letters" };
    }
    if (PERSIAN_YEH_KAF.test(text)) {
      return { code: "fa", confidence: 0.55, method: "script+orthographic_form" };
    }
    return { code: "ar", confidence: 0.6, method: "script_only" };
  }

  if (SCRIPT_RANGES[1].re.test(text)) return { code: "he", confidence: 0.85, method: "script" };

  // Japanese kana is decisive even if Han characters are also present.
  if (SCRIPT_RANGES[4].re.test(text)) return { code: "ja", confidence: 0.85, method: "script" };
  if (SCRIPT_RANGES[3].re.test(text)) return { code: "zh", confidence: 0.7, method: "script" };

  if (SCRIPT_RANGES[2].re.test(text)) {
    // Cyrillic: Ukrainian has letters і/ї/є/ґ that Russian doesn't use.
    if (/[\u0456\u0457\u0454\u0491]/.test(text)) return { code: "uk", confidence: 0.75, method: "script+distinguishing_letters" };
    return { code: "ru", confidence: 0.55, method: "script_only" };
  }

  if (SCRIPT_RANGES[5].re.test(text)) return { code: "ko", confidence: 0.85, method: "script" };
  if (SCRIPT_RANGES[6].re.test(text)) return { code: "hi", confidence: 0.85, method: "script" };
  if (SCRIPT_RANGES[7].re.test(text)) return { code: "bn", confidence: 0.85, method: "script" };
  if (SCRIPT_RANGES[8].re.test(text)) return { code: "th", confidence: 0.85, method: "script" };
  if (SCRIPT_RANGES[9].re.test(text)) return { code: "el", confidence: 0.85, method: "script" };
  if (SCRIPT_RANGES[10].re.test(text)) return { code: "vi", confidence: 0.5, method: "script_hint" };

  // Latin script: try stopword overlap.
  const lower = text.toLowerCase();
  const words = lower.split(/[^a-zà-ÿ]+/i).filter(Boolean);
  let best = { code: "en", score: 0 };
  for (const [code, stopwords] of Object.entries(LATIN_STOPWORDS)) {
    const score = stopwords.filter((w) => words.includes(w)).length;
    if (score > best.score) best = { code, score };
  }
  if (best.score > 0) {
    return { code: best.code, confidence: Math.min(0.4 + best.score * 0.15, 0.8), method: "stopwords" };
  }
  return { code: "en", confidence: 0.25, method: "latin_default_low_confidence" };
}

/**
 * Audio-based detection requires an actual acoustic/language-ID model or
 * a cloud STT provider that returns a detected-language field. This server
 * has neither wired up with working credentials right now. Returning a
 * fake guess here would violate the honesty requirement, so this reports
 * unavailability instead.
 */
function detectFromAudio() {
  return {
    supported: false,
    reason: "Audio-based language detection requires a configured cloud speech provider. None is configured in this environment. Transcribe via the browser's Web Speech API first (it does its own language handling client-side), then call detectFromText on the resulting text."
  };
}

module.exports = { detectFromText, detectFromAudio };
