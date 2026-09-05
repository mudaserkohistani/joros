"use strict";
/**
 * Registry of project types JOROS can recognize. Each entry declares
 * whether a real generator exists yet. Detecting a type whose generator
 * isn't implemented does NOT fall through to silently building something
 * else — the pipeline reports it plainly and stops (see pipeline.js).
 *
 * Adding a new project type = add an entry here + implement its generator
 * under server/lib/templates/. Nothing else in the pipeline needs to
 * change, by design (this is the extension point called out in the
 * architecture doc for Android/iOS/desktop/games/bots/etc.).
 */

const REGISTRY = [
  {
    type: "website",
    label: "Static Website",
    implemented: true,
    generatorModule: "./templates/staticSite/generate",
    score(req) {
      let s = 0;
      if (req.platformHints.includes("website")) s += 3;
      if (!req.platformHints.includes("webApp") && !req.features.includes("authentication")) s += 1;
      return s;
    }
  },
  {
    type: "web_app",
    label: "Web Application",
    implemented: true,
    // MVP note: web_app currently reuses the static-site generator with a
    // richer feature set (cart, admin, contact) — a real dynamic backend
    // (auth sessions, persistent DB) is the next generator to build, not
    // faked here. See docs/ROADMAP.md.
    generatorModule: "./templates/staticSite/generate",
    score(req) {
      let s = 0;
      if (req.platformHints.includes("webApp")) s += 3;
      if (req.features.includes("shoppingCart")) s += 1;
      if (req.features.includes("adminDashboard")) s += 1;
      if (req.features.includes("authentication")) s += 1;
      return s;
    }
  },
  {
    type: "android",
    label: "Android App",
    implemented: false,
    generatorModule: null,
    score: (req) => (req.platformHints.includes("android") ? 5 : 0)
  },
  {
    type: "ios",
    label: "iOS App",
    implemented: false,
    generatorModule: null,
    score: (req) => (req.platformHints.includes("ios") ? 5 : 0)
  },
  {
    type: "desktop",
    label: "Desktop App",
    implemented: false,
    generatorModule: null,
    score: (req) => (req.platformHints.includes("desktop") ? 5 : 0)
  },
  {
    type: "game",
    label: "Game",
    implemented: false,
    generatorModule: null,
    score: (req) => (req.platformHints.includes("game") ? 5 : 0)
  },
  {
    type: "api",
    label: "Backend API",
    implemented: false,
    generatorModule: null,
    score: (req) => (req.platformHints.includes("api") ? 5 : 0)
  },
  {
    type: "bot",
    label: "Bot (Telegram/Discord/Chat)",
    implemented: false,
    generatorModule: null,
    score: (req) => (req.platformHints.includes("bot") ? 5 : 0)
  },
  {
    type: "ai_app",
    label: "AI Application/Agent",
    implemented: false,
    generatorModule: null,
    score: (req) => (/\bai\b/i.test(req.rawText) && /agent|assistant|chatbot/i.test(req.rawText) ? 4 : 0)
  }
];

function detect(requirements) {
  const scored = REGISTRY.map((entry) => ({
    entry,
    score: typeof entry.score === "function" ? entry.score(requirements) : 0
  })).sort((a, b) => b.score - a.score);

  const best = scored[0];
  if (!best || best.score === 0) {
    // Default to website for generic requests with no strong signal —
    // still an honest, implemented choice, not a guess dressed as certainty.
    const fallback = REGISTRY.find((e) => e.type === "website");
    return { ...fallback, confidence: "low", alternatives: scored.slice(1, 4).map((s) => s.entry.type) };
  }
  return { ...best.entry, confidence: best.score >= 3 ? "high" : "medium", alternatives: scored.slice(1, 4).map((s) => s.entry.type) };
}

module.exports = { REGISTRY, detect };
