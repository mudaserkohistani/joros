"use strict";
/**
 * Handles "make the homepage darker" / "add a dark mode" style follow-up
 * requests against an already-generated project.
 *
 * MVP scope, stated honestly: this is a small set of real, working
 * heuristic edits (not a general-purpose code editor). Anything it doesn't
 * recognize, it says so rather than pretending to have made a change.
 * When ANTHROPIC_API_KEY is available this delegates to the LLM for
 * general-purpose edits instead.
 */
const fs = require("fs");
const path = require("path");
const { safeJoin, workspacePath } = require("./workspace");
const llm = require("./llmClient");

function readFileIfExists(projectId, rel) {
  const p = safeJoin(projectId, rel);
  return fs.existsSync(p) ? fs.readFileSync(p, "utf8") : null;
}
function writeFile(projectId, rel, content) {
  fs.writeFileSync(safeJoin(projectId, rel), content);
}

const HEURISTICS = [
  {
    match: /darker|dark(en)? (it|the (homepage|page|site|background))/i,
    apply(projectId) {
      const css = readFileIfExists(projectId, "styles.css");
      if (!css) return { applied: false, note: "No styles.css found to edit." };
      const updated = css
        .replace(/--bg:\s*#faf7f2;/, "--bg: #1c1a17;")
        .replace(/--fg:\s*#1f1b16;/, "--fg: #f2ede6;")
        .replace(/--card-bg:\s*#ffffff;/, "--card-bg: #2a2723;");
      if (updated === css) return { applied: false, note: "Color variables to darken were not found (styles.css may already be customized)." };
      writeFile(projectId, "styles.css", updated);
      return { applied: true, note: "Darkened background/foreground/card colors in styles.css.", filesChanged: ["styles.css"] };
    }
  },
  {
    match: /lighter|brighten/i,
    apply(projectId) {
      const css = readFileIfExists(projectId, "styles.css");
      if (!css) return { applied: false, note: "No styles.css found to edit." };
      const updated = css
        .replace(/--bg:\s*#[0-9a-fA-F]{6};/, "--bg: #ffffff;")
        .replace(/--fg:\s*#[0-9a-fA-F]{6};/, "--fg: #1f1b16;");
      writeFile(projectId, "styles.css", updated);
      return { applied: true, note: "Lightened background/foreground colors in styles.css.", filesChanged: ["styles.css"] };
    }
  },
  {
    match: /change (the )?accent color to (\w+)/i,
    apply(projectId, matchResult) {
      const colorWord = matchResult[2];
      const NAMED = { blue: "#2b5fb3", green: "#2b8a4e", red: "#b3312b", purple: "#7a3fb3", orange: "#c9772f" };
      const hex = NAMED[colorWord.toLowerCase()];
      if (!hex) return { applied: false, note: `Don't have a mapping for color "${colorWord}" in the offline editor.` };
      const css = readFileIfExists(projectId, "styles.css");
      if (!css) return { applied: false, note: "No styles.css found to edit." };
      const updated = css.replace(/--accent:\s*#[0-9a-fA-F]{6};/, `--accent: ${hex};`);
      writeFile(projectId, "styles.css", updated);
      return { applied: true, note: `Changed accent color to ${colorWord} (${hex}).`, filesChanged: ["styles.css"] };
    }
  }
];

async function applyEdit(projectId, instruction) {
  for (const h of HEURISTICS) {
    const m = instruction.match(h.match);
    if (m) {
      const result = h.apply(projectId, m);
      return { engine: "heuristic", instruction, ...result };
    }
  }

  if (llm.hasApiKey()) {
    try {
      // Real path for a genuinely general editor: ask the model for a
      // unified description of the change, applied to styles.css only in
      // this MVP (scoping the blast radius of an LLM-authored edit until a
      // proper diff/patch-review flow exists).
      const css = readFileIfExists(projectId, "styles.css") || "";
      const system = "You edit a single CSS file per instruction. Respond with ONLY the complete new CSS file content, no markdown fences, no commentary.";
      const userPrompt = `Current styles.css:\n${css}\n\nInstruction: ${instruction}`;
      const newCss = await llm.complete(system, userPrompt, 2048);
      writeFile(projectId, "styles.css", newCss.trim() + "\n");
      return { engine: "llm", instruction, applied: true, note: "Applied via LLM-generated CSS edit.", filesChanged: ["styles.css"] };
    } catch (err) {
      return { engine: "llm", instruction, applied: false, note: `LLM edit failed: ${err.message}` };
    }
  }

  return {
    engine: "none",
    instruction,
    applied: false,
    note: "This instruction isn't recognized by the offline editor, and no LLM is configured to handle general-purpose edits. Recognized offline instructions: darker/lighter, 'change the accent color to <blue|green|red|purple|orange>'."
  };
}

module.exports = { applyEdit };
