"use strict";
const fs = require("fs");
const path = require("path");
const { safeJoin, workspacePath } = require("./workspace");

const GENERATORS = {
  website: require("./templates/staticSite/generate"),
  web_app: require("./templates/staticSite/generate")
};

/**
 * Defense-in-depth: even though templates never interpolate secret values,
 * scan generated content before writing so a future generator bug can't
 * silently leak a configured secret into source. Matches common key
 * patterns and refuses to write the file if one appears as a literal value.
 */
const SECRET_LIKE_PATTERN = /(sk_live_|sk_test_|AKIA[0-9A-Z]{16}|-----BEGIN [A-Z ]*PRIVATE KEY-----)/;

function assertNoEmbeddedSecrets(relativePath, content) {
  if (SECRET_LIKE_PATTERN.test(content)) {
    throw new Error(
      `Refusing to write ${relativePath}: generated content appears to contain a literal secret value. This should never happen — generators must reference secrets via environment configuration only.`
    );
  }
}

/**
 * @returns {{files: {relativePath:string,bytes:number}[], generatorUsed: string, implemented: boolean}}
 */
function generateProject(projectId, plan) {
  const generatorModule = GENERATORS[plan.projectType];
  if (!generatorModule) {
    return {
      files: [],
      generatorUsed: null,
      implemented: false,
      reason: `No generator implemented yet for project type "${plan.projectType}". JOROS is not going to fabricate output for a platform it can't actually build. See docs/ROADMAP.md for what's planned.`
    };
  }

  const fileSpecs = generatorModule.generate(plan);
  const written = [];
  for (const { relativePath, content } of fileSpecs) {
    assertNoEmbeddedSecrets(relativePath, content);
    const fullPath = safeJoin(projectId, relativePath);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, content);
    written.push({ relativePath, bytes: Buffer.byteLength(content) });
  }

  return { files: written, generatorUsed: plan.projectType, implemented: true };
}

/** List the files actually present in a project's workspace (ground truth, not the plan's intent). */
function listWorkspaceFiles(projectId) {
  const root = workspacePath(projectId);
  const results = [];
  function walk(dir, prefix) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === ".env" || entry.name === "node_modules" || entry.name === ".git") continue;
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(path.join(dir, entry.name), rel);
      else results.push(rel);
    }
  }
  if (fs.existsSync(root)) walk(root, "");
  return results.sort();
}

module.exports = { generateProject, listWorkspaceFiles };
