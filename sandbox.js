"use strict";
/**
 * Sandboxed tool execution.
 *
 * Honest limitation: this is PROCESS-LEVEL isolation, not OS/container-level
 * isolation. It runs on the same kernel as the JOROS server. It enforces:
 *   - a hard allowlist of executables (no shell string is ever passed to a
 *     shell interpreter; we always use spawn(cmd, argsArray) with
 *     shell:false, so `;`, `&&`, `$()`, backticks etc. are inert)
 *   - argument-level rules per command (e.g. `npm` may only run a fixed set
 *     of subcommands)
 *   - a locked working directory inside the project's workspace (never the
 *     host root, never another project's workspace)
 *   - a wall-clock timeout and output size cap
 *   - no access to the parent process's full environment (only an explicit
 *     minimal env, plus the project's own configured secrets when
 *     requested)
 *
 * For a production deployment this process-level allowlist should be
 * layered UNDER real container/VM isolation (Docker/gVisor/Firecracker) —
 * this module alone is not sufficient defense-in-depth for untrusted or
 * adversarial input at scale, and this comment is here so nobody mistakes
 * the MVP for that.
 */
const { spawn } = require("child_process");
const path = require("path");
const { workspacePath } = require("./workspace");

const DEFAULT_TIMEOUT_MS = 60_000;
const MAX_OUTPUT_BYTES = 2 * 1024 * 1024;

// Command -> validator(args) => true/false. Fail closed: anything not
// listed here cannot be executed at all.
const ALLOWLIST = {
  npm: (args) => {
    const allowedSubcommands = ["install", "ci", "run", "test", "--version"];
    return args.length > 0 && allowedSubcommands.includes(args[0]);
  },
  node: (args) => {
    // Only allow running a .js file that lives inside the workspace (checked
    // by caller via safeJoin before we ever get here) — no `node -e`.
    return args.length > 0 && args[0].endsWith(".js") && !args.includes("-e");
  },
  git: (args) => {
    const allowed = ["init", "add", "commit", "status", "log", "diff"];
    return args.length > 0 && allowed.includes(args[0]);
  }
};

function isAllowed(cmd, args) {
  const validator = ALLOWLIST[cmd];
  if (!validator) return false;
  return validator(args);
}

/**
 * Run an allowlisted command inside a project's workspace.
 * @returns {Promise<{ok:boolean, code:number|null, stdout:string, stderr:string, timedOut:boolean, denied?:string}>}
 */
function run(projectId, cmd, args = [], { timeoutMs = DEFAULT_TIMEOUT_MS, extraEnv = {} } = {}) {
  return new Promise((resolve) => {
    if (!isAllowed(cmd, args)) {
      resolve({ ok: false, code: null, stdout: "", stderr: "", timedOut: false, denied: `Command not permitted by sandbox allowlist: ${cmd} ${args.join(" ")}` });
      return;
    }

    const cwd = workspacePath(projectId);
    const minimalEnv = {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      NODE_ENV: "production",
      ...extraEnv
    };

    let stdout = "";
    let stderr = "";
    let settled = false;

    const child = spawn(cmd, args, {
      cwd,
      env: minimalEnv,
      shell: false, // critical: no shell interpolation, ever
      timeout: timeoutMs
    });

    const timer = setTimeout(() => {
      if (!settled) child.kill("SIGKILL");
    }, timeoutMs);

    child.stdout.on("data", (d) => {
      if (stdout.length < MAX_OUTPUT_BYTES) stdout += d.toString();
    });
    child.stderr.on("data", (d) => {
      if (stderr.length < MAX_OUTPUT_BYTES) stderr += d.toString();
    });

    child.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ ok: false, code: null, stdout, stderr: stderr + `\n[spawn error] ${err.message}`, timedOut: false });
    });

    child.on("close", (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const timedOut = signal === "SIGKILL";
      resolve({ ok: code === 0 && !timedOut, code, stdout, stderr, timedOut });
    });
  });
}

module.exports = { run, isAllowed, ALLOWLIST };
