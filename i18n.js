"use strict";
const fs = require("fs");
const path = require("path");

const I18N_DIR = __dirname;
const cache = new Map();

function availableLocales() {
  return fs
    .readdirSync(I18N_DIR)
    .filter((f) => f.endsWith(".json"))
    .map((f) => f.replace(/\.json$/, ""));
}

function loadLocale(code) {
  if (cache.has(code)) return cache.get(code);
  const filePath = path.join(I18N_DIR, `${code}.json`);
  if (!fs.existsSync(filePath)) return null;
  const data = JSON.parse(fs.readFileSync(filePath, "utf8"));
  cache.set(code, data);
  return data;
}

/** Returns strings for `code`, falling back to English for any missing key, and entirely to English if the locale file doesn't exist. */
function getStrings(code) {
  const en = loadLocale("en") || {};
  if (code === "en") return en;
  const locale = loadLocale(code);
  if (!locale) return { ...en, _fallback: true, _requested: code };
  return { ...en, ...locale };
}

module.exports = { availableLocales, loadLocale, getStrings };
