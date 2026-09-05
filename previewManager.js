"use strict";
const http = require("http");
const fs = require("fs");
const path = require("path");
const { workspacePath, safeJoin } = require("./workspace");

// Preview servers are deliberately bound to 127.0.0.1 only, even in
// production. Each one serves a project's generated files on an
// OS-assigned port with no auth of its own — binding it publicly would mean
// anyone who can guess/scan a port sees a user's generated project. The
// main JOROS app (server/index.js) is what binds 0.0.0.0; if you need
// previews reachable from outside the host, put them behind your own
// reverse-proxy route (e.g. /preview/:id -> 127.0.0.1:<port>) rather than
// changing this binding. See docs/SECURITY.md.

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml"
};

// projectId -> { server, port }
const running = new Map();

function startPreview(projectId) {
  return new Promise((resolve, reject) => {
    if (running.has(projectId)) {
      const existing = running.get(projectId);
      resolve({ alreadyRunning: true, port: existing.port, url: `http://localhost:${existing.port}/` });
      return;
    }
    const root = workspacePath(projectId);
    const server = http.createServer((req, res) => {
      try {
        let reqPath = decodeURIComponent(req.url.split("?")[0]);
        if (reqPath === "/") reqPath = "/index.html";
        const filePath = safeJoin(projectId, "." + reqPath);
        if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
          res.writeHead(404, { "content-type": "text/plain" });
          res.end("Not found");
          return;
        }
        const ext = path.extname(filePath);
        res.writeHead(200, { "content-type": MIME[ext] || "application/octet-stream" });
        fs.createReadStream(filePath).pipe(res);
      } catch (err) {
        res.writeHead(400, { "content-type": "text/plain" });
        res.end("Bad request: " + err.message);
      }
    });

    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      running.set(projectId, { server, port });
      resolve({ alreadyRunning: false, port, url: `http://127.0.0.1:${port}/` });
    });
    server.on("error", reject);
  });
}

function stopPreview(projectId) {
  const entry = running.get(projectId);
  if (!entry) return { wasRunning: false };
  entry.server.close();
  running.delete(projectId);
  return { wasRunning: true };
}

function getStatus(projectId) {
  const entry = running.get(projectId);
  if (!entry) return { running: false };
  return { running: true, port: entry.port, url: `http://127.0.0.1:${entry.port}/` };
}

module.exports = { startPreview, stopPreview, getStatus };
