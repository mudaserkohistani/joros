"use strict";
/**
 * Secrets manager (MVP).
 *
 * Rules enforced by this module:
 *  - Secrets live ONLY in <workspace>/<projectId>/.env, a file that is (a)
 *    covered by the root .gitignore pattern and (b) also given its own
 *    per-project .gitignore entry as a second, redundant guarantee.
 *  - Values are write-only through this API: once set, GET calls only ever
 *    return whether a key is configured, never the value.
 *  - Generated frontend code is never templated with secret values (the
 *    code generator only ever emits `process.env.X` / references, never
 *    interpolated literals) — enforced in codeGenAgent.js.
 *  - Nothing in this module ever logs a secret value.
 */
const fs = require("fs");
const path = require("path");
const { workspacePath } = require("./workspace");

function envFilePath(projectId) {
  return path.join(workspacePath(projectId), ".env");
}

function ensureProjectGitignoreHasEnv(projectId) {
  const gitignorePath = path.join(workspacePath(projectId), ".gitignore");
  const line = ".env";
  let content = "";
  if (fs.existsSync(gitignorePath)) content = fs.readFileSync(gitignorePath, "utf8");
  if (!content.split("\n").includes(line)) {
    content = content.trim().length ? content.trim() + "\n" + line + "\n" : line + "\n";
    fs.writeFileSync(gitignorePath, content);
  }
}

function readEnvMap(projectId) {
  const p = envFilePath(projectId);
  if (!fs.existsSync(p)) return {};
  const map = {};
  for (const line of fs.readFileSync(p, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const idx = trimmed.indexOf("=");
    if (idx === -1) continue;
    map[trimmed.slice(0, idx)] = trimmed.slice(idx + 1);
  }
  return map;
}

function writeEnvMap(projectId, map) {
  const lines = Object.entries(map).map(([k, v]) => `${k}=${v}`);
  fs.writeFileSync(envFilePath(projectId), lines.join("\n") + "\n", { mode: 0o600 });
}

/** Set a secret value. Never returns or logs the value. */
function setSecret(projectId, key, value) {
  if (!/^[A-Z0-9_]+$/.test(key)) {
    throw new Error("Secret key must be UPPER_SNAKE_CASE (e.g. STRIPE_SECRET_KEY)");
  }
  ensureProjectGitignoreHasEnv(projectId);
  const map = readEnvMap(projectId);
  map[key] = String(value);
  writeEnvMap(projectId, map);
  return { key, configured: true };
}

/** Report which required secrets are configured, without ever exposing values. */
function getSecretStatus(projectId, requiredKeys = []) {
  const map = readEnvMap(projectId);
  return requiredKeys.map((key) => ({ key, configured: Object.prototype.hasOwnProperty.call(map, key) }));
}

function allConfigured(projectId, requiredKeys = []) {
  const map = readEnvMap(projectId);
  return requiredKeys.every((k) => Object.prototype.hasOwnProperty.call(map, k));
}

module.exports = { setSecret, getSecretStatus, allConfigured, envFilePath };
