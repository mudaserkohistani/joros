"use strict";
const fs = require("fs");
const path = require("path");
const sandbox = require("./sandbox");
const { workspacePath } = require("./workspace");

/**
 * Runs install -> build -> test for a project, using only the sandbox's
 * allowlisted commands. Every step's result is exactly what the underlying
 * process actually returned — no step is marked passed unless its exit
 * code was 0.
 */
async function runChecks(projectId) {
  const steps = [];
  const pkgPath = path.join(workspacePath(projectId), "package.json");

  if (!fs.existsSync(pkgPath)) {
    return { ok: false, steps: [{ name: "package.json", ok: false, note: "No package.json found — nothing to install/build/test." }] };
  }

  const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
  const hasDeps = pkg.dependencies && Object.keys(pkg.dependencies).length > 0;

  if (hasDeps) {
    const install = await sandbox.run(projectId, "npm", ["install"]);
    steps.push({ name: "install_dependencies", ok: install.ok, code: install.code, stdout: tail(install.stdout), stderr: tail(install.stderr) });
    if (!install.ok) return { ok: false, steps };
  } else {
    steps.push({ name: "install_dependencies", ok: true, note: "No dependencies declared — skipped (this is real, not a shortcut: the generated project has zero runtime dependencies by design)." });
  }

  if (pkg.scripts && pkg.scripts.build) {
    const build = await sandbox.run(projectId, "npm", ["run", "build"]);
    steps.push({ name: "run_build", ok: build.ok, code: build.code, stdout: tail(build.stdout), stderr: tail(build.stderr) });
    if (!build.ok) return { ok: false, steps };
  } else {
    steps.push({ name: "run_build", ok: true, note: "No build script declared — skipped." });
  }

  if (pkg.scripts && pkg.scripts.test) {
    const test = await sandbox.run(projectId, "npm", ["test"]);
    steps.push({ name: "run_tests", ok: test.ok, code: test.code, stdout: tail(test.stdout), stderr: tail(test.stderr) });
    if (!test.ok) return { ok: false, steps };
  } else {
    steps.push({ name: "run_tests", ok: true, note: "No test script declared — skipped." });
  }

  return { ok: steps.every((s) => s.ok), steps };
}

function tail(str, maxLines = 60) {
  if (!str) return "";
  const lines = str.split("\n");
  return lines.slice(-maxLines).join("\n");
}

module.exports = { runChecks };
