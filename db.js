"use strict";
/**
 * Minimal JSON-file-backed project index. Fully synchronous by design:
 * every operation here is a small fs.*Sync call, so wrapping it in
 * Promises added complexity (and a real bug, caught during testing) without
 * any actual concurrency benefit for a single-process MVP. Callers may
 * still `await` these functions safely since awaiting a non-Promise value
 * just resolves immediately.
 *
 * Honest scope note: this is a flat-file store, adequate for a single-node
 * MVP - not a production database (no true multi-process write safety, no
 * migrations, no indexing). Swapping this for Postgres/SQLite later should
 * not require changing callers, since the interface (list/get/create/update)
 * is the contract.
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const DATA_DIR = path.join(__dirname, "..", "..", "data");
const DB_FILE = path.join(DATA_DIR, "projects.json");

function ensureStore() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DB_FILE)) fs.writeFileSync(DB_FILE, JSON.stringify({ projects: {} }, null, 2));
}

function readAll() {
  ensureStore();
  return JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
}

function writeAll(data) {
  fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
}

function createProject({ id, name, requestText }) {
  const data = readAll();
  const projectId = id || crypto.randomUUID();
  const now = new Date().toISOString();
  data.projects[projectId] = {
    id: projectId,
    name: name || "Untitled Project",
    requestText,
    status: "created",
    createdAt: now,
    updatedAt: now,
    requirements: null,
    projectType: null,
    plan: null,
    pendingConfirmations: [],
    log: [],
    files: [],
    lastTestResult: null,
    preview: null
  };
  writeAll(data);
  return data.projects[projectId];
}

function getProject(id) {
  const data = readAll();
  return data.projects[id] || null;
}

function listProjects() {
  const data = readAll();
  return Object.values(data.projects).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

function updateProject(id, patch) {
  const data = readAll();
  if (!data.projects[id]) throw new Error(`Unknown project: ${id}`);
  data.projects[id] = { ...data.projects[id], ...patch, updatedAt: new Date().toISOString() };
  writeAll(data);
  return data.projects[id];
}

function appendLog(id, entry) {
  const data = readAll();
  if (!data.projects[id]) throw new Error(`Unknown project: ${id}`);
  const logEntry = { ts: new Date().toISOString(), ...entry };
  data.projects[id].log.push(logEntry);
  data.projects[id].updatedAt = logEntry.ts;
  writeAll(data);
  return logEntry;
}

module.exports = { createProject, getProject, listProjects, updateProject, appendLog };
