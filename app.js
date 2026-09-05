"use strict";

const state = { currentProjectId: null, pollTimer: null };

async function api(path, opts) {
  const res = await fetch(path, {
    ...opts,
    headers: { "content-type": "application/json", ...(opts && opts.headers) }
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error || "Request failed");
  return body;
}

function statusClass(status) {
  if (["verified"].includes(status)) return "pill-ok";
  if (["failed_checks", "generation_not_implemented", "cancelled"].includes(status)) return "pill-err";
  if (["awaiting_confirmation"].includes(status)) return "pill-warn";
  return "";
}

async function loadSystemStatus() {
  try {
    const s = await api("/api/system/status");
    document.getElementById("system-status").textContent =
      (s.llmAvailable ? "LLM: connected" : "LLM: offline (template mode)") + " · sandbox: process-level allowlist";
    document.getElementById("system-status").title = s.llmNote;
  } catch (err) {
    document.getElementById("system-status").textContent = "status unavailable";
  }
}

async function loadProjectList() {
  const { projects } = await api("/api/projects");
  const ul = document.getElementById("project-list");
  ul.innerHTML = "";
  for (const p of projects) {
    const li = document.createElement("li");
    li.textContent = `${p.name} — ${p.status}`;
    li.onclick = () => openProject(p.id);
    ul.appendChild(li);
  }
}

document.getElementById("build-btn").addEventListener("click", async () => {
  const message = document.getElementById("idea-input").value.trim();
  if (!message) return;
  const btn = document.getElementById("build-btn");
  btn.disabled = true;
  btn.textContent = "Building…";
  try {
    const project = await api("/api/projects", { method: "POST", body: JSON.stringify({ message }) });
    await openProject(project.id);
    await loadProjectList();
  } catch (err) {
    alert("Error: " + err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = "Build it";
  }
});

async function openProject(id) {
  state.currentProjectId = id;
  document.getElementById("project-view").hidden = false;
  await refreshProject();
}

async function refreshProject() {
  const id = state.currentProjectId;
  if (!id) return;
  const project = await api(`/api/projects/${id}`);
  renderProject(project);
}

function renderProject(project) {
  document.getElementById("project-name").textContent = project.name;
  const statusEl = document.getElementById("project-status");
  statusEl.textContent = project.status;
  statusEl.className = "status-pill " + statusClass(project.status);

  renderLog(project.log || []);
  renderFiles(project.files || []);
  renderConfirmations(project);
  renderSecrets(project);
  renderPreview(project);
}

function renderLog(log) {
  const view = document.getElementById("log-view");
  view.innerHTML = log
    .map((entry) => {
      let cls = "log-line";
      if (/FAIL/.test(entry.message)) cls += " log-fail";
      if (/PASS|verified/.test(entry.message)) cls += " log-pass";
      return `<div class="${cls}"><span class="log-stage">[${entry.stage}]</span> ${escapeHtml(entry.message)}</div>`;
    })
    .join("");
  view.scrollTop = view.scrollHeight;
}

function renderFiles(files) {
  const list = document.getElementById("file-list");
  list.innerHTML = files.length
    ? files.map((f) => `<li>${escapeHtml(f)}</li>`).join("")
    : "<li>(no files generated yet)</li>";
}

function renderConfirmations(project) {
  const panel = document.getElementById("confirmation-panel");
  const list = document.getElementById("confirmation-list");
  const pending = project.pendingConfirmations || [];
  if (pending.length === 0) {
    panel.hidden = true;
    return;
  }
  panel.hidden = false;
  list.innerHTML = "";
  for (const item of pending) {
    const row = document.createElement("div");
    row.className = "confirm-item";
    row.innerHTML = `<div><strong>${item.category}</strong>: ${escapeHtml(item.description)}</div>
      <div class="confirm-actions">
        <button data-approve="true">Approve</button>
        <button class="secondary" data-approve="false">Decline</button>
      </div>`;
    row.querySelectorAll("button").forEach((btn) => {
      btn.onclick = async () => {
        await api(`/api/projects/${project.id}/confirm`, {
          method: "POST",
          body: JSON.stringify({ actionId: item.id, approve: btn.dataset.approve === "true" })
        });
        await refreshProject();
      };
    });
    list.appendChild(row);
  }
}

function renderSecrets(project) {
  const panel = document.getElementById("secrets-panel");
  const requiredMentioned = (project.log || []).some((e) => e.stage === "credentials");
  panel.hidden = !requiredMentioned;
  if (!requiredMentioned) return;

  const form = document.getElementById("secret-form");
  form.onsubmit = async (e) => {
    e.preventDefault();
    const key = document.getElementById("secret-key").value.trim();
    const value = document.getElementById("secret-value").value;
    if (!key || !value) return;
    await api(`/api/projects/${project.id}/secrets`, { method: "POST", body: JSON.stringify({ key, value }) });
    document.getElementById("secret-key").value = "";
    document.getElementById("secret-value").value = "";
    await refreshProject();
  };
}

function renderPreview(project) {
  const area = document.getElementById("preview-area");
  if (project.preview && project.preview.url) {
    area.innerHTML = `<p>Running at <a href="${project.preview.url}" target="_blank">${project.preview.url}</a></p>
      <iframe src="${project.preview.url}"></iframe>`;
  } else {
    area.innerHTML = `<p class="hint">No preview running.</p>`;
  }
}

document.getElementById("iterate-btn").addEventListener("click", async () => {
  const id = state.currentProjectId;
  if (!id) return;
  const message = document.getElementById("iterate-input").value.trim();
  if (!message) return;
  const resultEl = document.getElementById("iterate-result");
  resultEl.textContent = "Applying…";
  try {
    const res = await api(`/api/projects/${id}/message`, { method: "POST", body: JSON.stringify({ message }) });
    resultEl.textContent = res.edit.applied ? `✓ ${res.edit.note}` : `Not applied — ${res.edit.note}`;
    await refreshProject();
  } catch (err) {
    resultEl.textContent = "Error: " + err.message;
  }
});

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// Exposed so web/voice.js (loaded after this script) can read/drive the
// same current-project state without duplicating project-management logic.
window.JorosState = state;
window.JorosRefreshProject = refreshProject;

loadSystemStatus();
loadProjectList();
