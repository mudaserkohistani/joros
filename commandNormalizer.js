"use strict";
/**
 * Normalizes a voice/text command in a supported language into the same
 * canonical English instruction string that server/lib/iterate.js already
 * knows how to apply (its HEURISTICS regexes). This lets "make the
 * homepage darker" / "صفحه اصلی را تاریک‌تر کن" / "د اصلي پاڼې رنګونه تیاره
 * کړه" / "mach die startseite dunkler" / "اجعل الصفحة الرئيسية أغمق" all
 * drive the SAME existing edit logic — no duplication of the actual edit
 * behavior, just translation of intent.
 *
 * Honest scope: this is a small, real phrase dictionary for the command
 * set iterate.js currently supports (darker/lighter/accent color), for the
 * five languages that have full UI translations (en/fa/ps/de/ar). It is
 * not a general-purpose translator. Anything it doesn't recognize is
 * reported as unmatched, not guessed at.
 */

// Languages with a real (if small) offline command dictionary below.
// languages/registry.js reads this set to compute support tiers.
const SUPPORTED_COMMAND_LANGUAGES = new Set(["en", "fa", "ps", "de", "ar"]);

const DICTIONARY = [
  {
    canonical: "make the homepage darker",
    patterns: {
      en: [/\b(make|turn) (it|the (home ?page|site|page))?\s*darker\b/i, /\bdark(en)? (it|the (home ?page|page|site))\b/i],
      fa: [/تاریک/],
      ps: [/تیاره/, /تور/],
      de: [/dunkler/i, /dunkel/i],
      ar: [/أغمق/, /داكن/]
    }
  },
  {
    canonical: "make it lighter",
    patterns: {
      en: [/\b(make|turn) (it|the (home ?page|site|page))?\s*lighter\b/i, /\bbrighten\b/i],
      fa: [/روشن/],
      ps: [/روښانه/],
      de: [/heller/i],
      ar: [/أفتح/, /أضاء/]
    }
  }
];

/**
 * @param {string} text  already-transcribed text (from any STT source)
 * @param {string} languageCode  ISO code, or 'auto' to try all supported dictionaries
 * @returns {{matched: boolean, canonical?: string, languageCode?: string}}
 */
function normalize(text, languageCode = "auto") {
  if (!text || !text.trim()) return { matched: false, reason: "empty_input" };

  const langsToTry = languageCode === "auto" ? Array.from(SUPPORTED_COMMAND_LANGUAGES) : [languageCode];

  for (const entry of DICTIONARY) {
    for (const lang of langsToTry) {
      const patterns = entry.patterns[lang];
      if (!patterns) continue;
      if (patterns.some((re) => re.test(text))) {
        return { matched: true, canonical: entry.canonical, languageCode: lang };
      }
    }
  }
  return { matched: false, reason: "no_dictionary_match", triedLanguages: langsToTry };
}

module.exports = { normalize, SUPPORTED_COMMAND_LANGUAGES, DICTIONARY };
