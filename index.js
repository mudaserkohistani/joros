"use strict";
const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const db = require("./lib/db");
const pipeline = require("./lib/pipeline");
const codeGenAgent = require("./lib/codeGenAgent");
const secretsManager = require("./lib/secretsManager");
const previewManager = require("./lib/previewManager");
const llm = require("./lib/llmClient");
const iterate = require("./lib/iterate");
const { safeJoin } = require("./lib/workspace");
const voicePipeline = require("./lib/voicePipeline");
const languageRegistry = require("../languages/registry");
const languageDetection = require("../speech/language-detection");
const sttInterface = require("../speech/speech-to-text");
const ttsInterface = require("../speech/text-to-speech");
const i18n = require("../i18n/i18n");

const PORT = process.env.PORT || 4790;
const HOST = process.env.HOST || "0.0.0.0";
const WEB_DIR = path.join(__dirname, "..", "web");

const WEB_MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8"
};

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj, null, 2);
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => {
      if (!data) return resolve({});
      try {
        resolve(JSON.parse(data));
      } catch (err) {
        reject(new Error("Invalid JSON body"));
      }
    });
    req.on("error", reject);
  });
}

// Whitelisted shared modules that are safe to serve as-is to the browser
// (pure logic, no `fs`/`require` of Node-only things at call time). Kept as
// an explicit allowlist rather than exposing entire directories, since most
// of voice/ and languages/ do use Node's `fs`/`require`.
const SHARED_CLIENT_FILES = {
  "/shared/voiceStateMachine.js": path.join(__dirname, "..", "voice", "voiceStateMachine.js")
};

function serveStatic(req, res) {
  let reqPath = decodeURIComponent(req.url.split("?")[0]);
  if (SHARED_CLIENT_FILES[reqPath]) {
    res.writeHead(200, { "content-type": "application/javascript; charset=utf-8" });
    fs.createReadStream(SHARED_CLIENT_FILES[reqPath]).pipe(res);
    return;
  }
  if (reqPath === "/") reqPath = "/index.html";
  const filePath = path.join(WEB_DIR, reqPath);
  if (!filePath.startsWith(WEB_DIR) || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    res.writeHead(404, { "content-type": "text/plain" });
    res.end("Not found");
    return;
  }
  const ext = path.extname(filePath);
  res.writeHead(200, { "content-type": WEB_MIME[ext] || "application/octet-stream" });
  fs.createReadStream(filePath).pipe(res);
}

const routes = [
  {
    method: "GET",
    pattern: /^\/health$/,
    handler: async (req, res) => {
      sendJson(res, 200, {
        status: "ok",
        service: "joros",
        uptimeSeconds: Math.round(process.uptime()),
        timestamp: new Date().toISOString()
      });
    }
  },
  {
    method: "GET",
    pattern: /^\/api\/system\/status$/,
    handler: async (req, res) => {
      sendJson(res, 200, {
        llmAvailable: llm.hasApiKey(),
        llmNote: llm.hasApiKey()
          ? "ANTHROPIC_API_KEY is configured. Note: this build has not been network-tested end-to-end against the live API."
          : "No ANTHROPIC_API_KEY configured — running in offline template-generation mode.",
        implementedProjectTypes: ["website", "web_app"],
        notImplementedProjectTypes: ["android", "ios", "desktop", "game", "api", "bot", "ai_app"],
        sandbox: "process-level allowlist (npm/node/git subcommands only) — NOT container/VM isolated"
      });
    }
  },
  {
    method: "GET",
    pattern: /^\/api\/projects$/,
    handler: async (req, res) => {
      sendJson(res, 200, { projects: db.listProjects() });
    }
  },
  {
    method: "POST",
    pattern: /^\/api\/projects$/,
    handler: async (req, res) => {
      const body = await readBody(req);
      if (!body.message || typeof body.message !== "string" || !body.message.trim()) {
        sendJson(res, 400, { error: "Provide a 'message' describing what to build." });
        return;
      }
      const project = await db.createProject({ name: deriveName(body.message), requestText: body.message.trim() });
      const result = await pipeline.runPipeline(project.id);
      sendJson(res, 201, result);
    }
  },
  {
    method: "GET",
    pattern: /^\/api\/projects\/([a-zA-Z0-9-]+)$/,
    handler: async (req, res, [id]) => {
      const project = db.getProject(id);
      if (!project) return sendJson(res, 404, { error: "Not found" });
      sendJson(res, 200, project);
    }
  },
  {
    method: "POST",
    pattern: /^\/api\/projects\/([a-zA-Z0-9-]+)\/confirm$/,
    handler: async (req, res, [id]) => {
      const body = await readBody(req);
      if (!body.actionId) return sendJson(res, 400, { error: "actionId is required" });
      try {
        const result = await pipeline.confirmAction(id, body.actionId, Boolean(body.approve));
        sendJson(res, 200, result);
      } catch (err) {
        sendJson(res, 400, { error: err.message });
      }
    }
  },
  {
    method: "POST",
    pattern: /^\/api\/projects\/([a-zA-Z0-9-]+)\/message$/,
    handler: async (req, res, [id]) => {
      const body = await readBody(req);
      if (!body.message) return sendJson(res, 400, { error: "message is required" });
      const project = db.getProject(id);
      if (!project) return sendJson(res, 404, { error: "Not found" });
      db.appendLog(id, { stage: "iterate", message: `User requested change: "${body.message}"` });
      const result = await iterate.applyEdit(id, body.message);
      db.appendLog(id, { stage: "iterate", message: result.applied ? `Applied: ${result.note}` : `Not applied: ${result.note}`, engine: result.engine });
      // Re-run checks + preview refresh so the UI reflects reality after an edit.
      const testRunner = require("./lib/testRunner");
      const testResult = await testRunner.runChecks(id);
      db.updateProject(id, { lastTestResult: testResult, status: testResult.ok ? "verified" : "failed_checks" });
      sendJson(res, 200, { edit: result, testResult, project: db.getProject(id) });
    }
  },
  {
    method: "GET",
    pattern: /^\/api\/projects\/([a-zA-Z0-9-]+)\/files$/,
    handler: async (req, res, [id]) => {
      const project = db.getProject(id);
      if (!project) return sendJson(res, 404, { error: "Not found" });
      sendJson(res, 200, { files: codeGenAgent.listWorkspaceFiles(id) });
    }
  },
  {
    method: "GET",
    pattern: /^\/api\/projects\/([a-zA-Z0-9-]+)\/files\/(.+)$/,
    handler: async (req, res, [id, rel]) => {
      try {
        const filePath = safeJoin(id, rel);
        if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
          return sendJson(res, 404, { error: "File not found" });
        }
        res.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
        fs.createReadStream(filePath).pipe(res);
      } catch (err) {
        sendJson(res, 400, { error: err.message });
      }
    }
  },
  {
    method: "GET",
    pattern: /^\/api\/projects\/([a-zA-Z0-9-]+)\/secrets$/,
    handler: async (req, res, [id]) => {
      const project = db.getProject(id);
      if (!project) return sendJson(res, 404, { error: "Not found" });
      const requiredKeys = extractRequiredSecretKeys(project);
      sendJson(res, 200, { secrets: secretsManager.getSecretStatus(id, requiredKeys) });
    }
  },
  {
    method: "POST",
    pattern: /^\/api\/projects\/([a-zA-Z0-9-]+)\/secrets$/,
    handler: async (req, res, [id]) => {
      const body = await readBody(req);
      if (!body.key || body.value === undefined) return sendJson(res, 400, { error: "key and value are required" });
      try {
        const result = secretsManager.setSecret(id, body.key, body.value);
        db.appendLog(id, { stage: "credentials", message: `Secret configured: ${body.key} (value not logged)` });
        sendJson(res, 200, result);
      } catch (err) {
        sendJson(res, 400, { error: err.message });
      }
    }
  },
  {
    method: "POST",
    pattern: /^\/api\/projects\/([a-zA-Z0-9-]+)\/preview\/start$/,
    handler: async (req, res, [id]) => {
      const project = db.getProject(id);
      if (!project) return sendJson(res, 404, { error: "Not found" });
      const preview = await previewManager.startPreview(id);
      db.updateProject(id, { preview });
      sendJson(res, 200, preview);
    }
  },
  {
    method: "POST",
    pattern: /^\/api\/projects\/([a-zA-Z0-9-]+)\/preview\/stop$/,
    handler: async (req, res, [id]) => {
      const result = previewManager.stopPreview(id);
      db.updateProject(id, { preview: null });
      sendJson(res, 200, result);
    }
  },
  {
    method: "GET",
    pattern: /^\/api\/projects\/([a-zA-Z0-9-]+)\/preview$/,
    handler: async (req, res, [id]) => {
      sendJson(res, 200, previewManager.getStatus(id));
    }
  },

  // --- Voice / multilingual routes -----------------------------------
  {
    method: "GET",
    pattern: /^\/api\/languages$/,
    handler: async (req, res) => {
      sendJson(res, 200, { languages: languageRegistry.listLanguages() });
    }
  },
  {
    method: "GET",
    pattern: /^\/api\/i18n\/([a-zA-Z-]+)$/,
    handler: async (req, res, [code]) => {
      sendJson(res, 200, { code, strings: i18n.getStrings(code) });
    }
  },
  {
    method: "GET",
    pattern: /^\/api\/voice\/status$/,
    handler: async (req, res) => {
      const cloudStt = require("../speech/providers/cloudSpeechProvider");
      sendJson(res, 200, {
        providers: sttInterface.listProviders(),
        browserProvider: {
          available: true,
          note: "Executes entirely client-side via the Web Speech API. Always 'available' from the server's point of view; actual availability depends on the user's browser and microphone permission."
        },
        cloudProvider: {
          sttConfigured: cloudStt.stt.isConfigured(),
          ttsConfigured: cloudStt.tts.isConfigured(),
          note: cloudStt.stt.isConfigured() || cloudStt.tts.isConfigured()
            ? "Cloud provider is configured but has not been network-tested in this environment."
            : "Cloud provider is not configured. Set VOICE_STT_URL/VOICE_STT_API_KEY and/or VOICE_TTS_URL/VOICE_TTS_API_KEY to enable it."
        },
        offlineMode: !cloudStt.stt.isConfigured() && !cloudStt.tts.isConfigured()
      });
    }
  },
  {
    method: "POST",
    pattern: /^\/api\/voice\/detect-language$/,
    handler: async (req, res) => {
      const body = await readBody(req);
      if (!body.text) return sendJson(res, 400, { error: "text is required" });
      sendJson(res, 200, languageDetection.detectFromText(body.text));
    }
  },
  {
    method: "POST",
    pattern: /^\/api\/voice\/synthesize$/,
    handler: async (req, res) => {
      const body = await readBody(req);
      if (!body.text) return sendJson(res, 400, { error: "text is required" });
      const provider = body.provider || "cloud";
      try {
        const result = await ttsInterface.synthesize(provider, body.text, { languageCode: body.languageCode, speed: body.speed, voice: body.voice });
        sendJson(res, 200, result);
      } catch (err) {
        sendJson(res, 503, { error: err.message, fallback: "Use the 'browser' provider (window.speechSynthesis) client-side instead." });
      }
    }
  },
  {
    method: "POST",
    pattern: /^\/api\/projects\/([a-zA-Z0-9-]+)\/voice-message$/,
    handler: async (req, res, [id]) => {
      const body = await readBody(req);
      if (!body.transcript) return sendJson(res, 400, { error: "transcript is required (already-transcribed text from client-side STT)" });
      const project = db.getProject(id);
      if (!project) return sendJson(res, 404, { error: "Not found" });
      try {
        const result = await voicePipeline.handleVoiceCommand(id, body.transcript, body.languageCode || "auto");
        sendJson(res, 200, result);
      } catch (err) {
        sendJson(res, 400, { error: err.message });
      }
    }
  }
];

function extractRequiredSecretKeys(project) {
  if (!project.log) return [];
  const keys = new Set();
  for (const entry of project.log) {
    const noteMatch = (entry.note || "") + (entry.message || "");
    const m = noteMatch.match(/\b([A-Z][A-Z0-9_]{3,})\b/g);
    if (m) m.filter((k) => k.includes("_") && /KEY|SECRET|TOKEN/.test(k)).forEach((k) => keys.add(k));
  }
  return Array.from(keys);
}

function deriveName(message) {
  const trimmed = message.trim().replace(/\s+/g, " ");
  return trimmed.length > 60 ? trimmed.slice(0, 57) + "..." : trimmed;
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.url.startsWith("/api/") || req.url === "/health") {
      const url = req.url.split("?")[0];
      const route = routes.find((r) => r.method === req.method && r.pattern.test(url));
      if (!route) {
        sendJson(res, 404, { error: "No such route" });
        return;
      }
      const match = url.match(route.pattern);
      await route.handler(req, res, match.slice(1));
      return;
    }
    serveStatic(req, res);
  } catch (err) {
    console.error(err);
    sendJson(res, 500, { error: err.message });
  }
});

server.listen(PORT, HOST, () => {
  const displayHost = HOST === "0.0.0.0" ? "0.0.0.0 (all interfaces)" : HOST;
  console.log(`JOROS listening on ${displayHost}:${PORT} (visit http://localhost:${PORT} locally)`);
  console.log(`Health check: http://localhost:${PORT}/health`);
  console.log(`LLM generation: ${llm.hasApiKey() ? "enabled (ANTHROPIC_API_KEY set)" : "OFFLINE (template fallback only)"}`);
});

module.exports = server;
