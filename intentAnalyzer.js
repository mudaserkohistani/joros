"use strict";
/**
 * Turns free-text user requests into structured requirements.
 *
 * Two modes:
 *  - LLM mode: if ANTHROPIC_API_KEY + network are available, ask Claude to
 *    extract structured requirements as JSON.
 *  - Heuristic fallback: keyword/pattern matching. Deterministic, testable,
 *    and what actually runs in this sandbox. Covers the feature set named
 *    in the MVP brief (menu, cart, contact, admin, auth, payments, etc.)
 *    plus generic entity detection so it's not hardcoded to one demo
 *    sentence.
 */
const llm = require("./llmClient");

const FEATURE_KEYWORDS = {
  shoppingCart: [/shopping cart/i, /\bcart\b/i, /add to cart/i, /checkout/i],
  payments: [/payment/i, /\bstripe\b/i, /\bpaypal\b/i, /checkout/i, /\bpay\b/i],
  adminDashboard: [/admin (dashboard|panel)/i, /back[- ]?office/i, /manage (orders|content|products|users)/i],
  authentication: [/\blogin\b/i, /\bsign ?up\b/i, /\bauthentication\b/i, /\baccounts?\b/i, /\buser accounts?\b/i],
  contactForm: [/contact (page|form|us)/i],
  menu: [/\bmenu\b/i],
  booking: [/\bbook(ing)?\b/i, /\breservations?\b/i, /\bappointments?\b/i],
  notifications: [/notifications?/i, /\balerts?\b/i],
  chat: [/\bchat\b/i, /\bmessaging\b/i, /\blive chat\b/i],
  blog: [/\bblog\b/i, /\barticles?\b/i, /\bposts?\b/i],
  search: [/\bsearch\b/i],
  gallery: [/\bgallery\b/i, /\bportfolio\b/i, /\bphotos?\b/i],
  multiLanguage: [/multi[- ]?language/i, /\bi18n\b/i, /\btranslations?\b/i],
  darkMode: [/dark mode/i]
};

const PLATFORM_KEYWORDS = {
  android: [/\bandroid\b/i],
  ios: [/\bios\b/i, /\biphone\b/i],
  desktop: [/\bdesktop app\b/i, /\bwindows app\b/i, /\bmac(os)? app\b/i],
  game: [/\bgame\b/i],
  api: [/\bapi\b/i, /\bbackend only\b/i, /\brest api\b/i],
  bot: [/\btelegram bot\b/i, /\bdiscord bot\b/i, /\bchatbot\b/i, /\bbot\b/i],
  webApp: [/\bweb app\b/i, /\bweb application\b/i, /\bsaas\b/i, /\bdashboard\b/i],
  website: [/\bwebsite\b/i, /\bsite\b/i, /\blanding page\b/i]
};

function detectByKeywordMap(text, map) {
  const hits = [];
  for (const [key, patterns] of Object.entries(map)) {
    if (patterns.some((re) => re.test(text))) hits.push(key);
  }
  return hits;
}

/** Very lightweight entity/subject extraction: nouns following "for a" / domain hints. */
function guessDomain(text) {
  const domainHints = [
    { re: /restaurant/i, domain: "restaurant" },
    { re: /\bcafe\b|\bcoffee shop\b/i, domain: "cafe" },
    { re: /\bstore\b|\bshop\b|\becommerce\b|\be-commerce\b/i, domain: "store" },
    { re: /\bportfolio\b/i, domain: "portfolio" },
    { re: /\bblog\b/i, domain: "blog" },
    { re: /\breal estate\b/i, domain: "real_estate" },
    { re: /\bgym\b|\bfitness\b/i, domain: "fitness" },
    { re: /\bschool\b|\bcourse\b|\beducation\b/i, domain: "education" }
  ];
  const found = domainHints.find((h) => h.re.test(text));
  return found ? found.domain : "generic_business";
}

function heuristicAnalyze(text) {
  const features = detectByKeywordMap(text, FEATURE_KEYWORDS);
  const platformHints = detectByKeywordMap(text, PLATFORM_KEYWORDS);
  const domain = guessDomain(text);
  return {
    rawText: text,
    domain,
    features,
    platformHints,
    mode: "heuristic"
  };
}

async function llmAnalyze(text) {
  const system = [
    "You extract structured software requirements from a user's plain-language product idea.",
    "Respond with ONLY a JSON object, no markdown fences, no prose, matching this shape:",
    '{"domain": string, "features": string[], "platformHints": string[], "notes": string}',
    "features and platformHints should be short snake_case or camelCase tokens."
  ].join(" ");
  const raw = await llm.complete(system, text, 1024);
  const cleaned = raw.replace(/```json|```/g, "").trim();
  const parsed = JSON.parse(cleaned);
  return { ...parsed, rawText: text, mode: "llm" };
}

async function analyze(text) {
  if (llm.hasApiKey()) {
    try {
      return await llmAnalyze(text);
    } catch (err) {
      // Fall through to heuristic — never silently pretend the LLM path
      // succeeded when it didn't.
      const fallback = heuristicAnalyze(text);
      fallback.llmError = err.message;
      return fallback;
    }
  }
  return heuristicAnalyze(text);
}

module.exports = { analyze, heuristicAnalyze };
