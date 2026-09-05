"use strict";
/**
 * Every module that touches the filesystem or spawns a process for a
 * project MUST resolve paths through here. This is the single choke point
 * that prevents path traversal out of a project's sandboxed directory.
 */
const fs = require("fs");
const path = require("path");

const WORKSPACES_ROOT = path.resolve(__dirname, "..", "..", "workspaces");

function ensureRoot() {
  if (!fs.existsSync(WORKSPACES_ROOT)) fs.mkdirSync(WORKSPACES_ROOT, { recursive: true });
}

function workspacePath(projectId) {
  ensureRoot();
  if (!/^[a-zA-Z0-9-]+$/.test(projectId)) {
    throw new Error("Invalid project id");
  }
  const dir = path.join(WORKSPACES_ROOT, projectId);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * Resolve a relative path *inside* a project's workspace, throwing if the
 * result would escape the workspace root (blocks `../../etc/passwd` style
 * traversal from generated file paths or API input).
 */
function safeJoin(projectId, relativePath) {
  const base = workspacePath(projectId);
  const resolved = path.resolve(base, relativePath || ".");
  if (resolved !== base && !resolved.startsWith(base + path.sep)) {
    throw new Error(`Path escapes workspace sandbox: ${relativePath}`);
  }
  return resolved;
}

module.exports = { WORKSPACES_ROOT, workspacePath, safeJoin };
