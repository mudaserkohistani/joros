"use strict";
const db = require("./db");
const intentAnalyzer = require("./intentAnalyzer");
const projectTypeDetector = require("./projectTypeDetector");
const planner = require("./planner");
const confirmationPolicy = require("./confirmationPolicy");
const codeGenAgent = require("./codeGenAgent");
const testRunner = require("./testRunner");
const previewManager = require("./previewManager");
const secretsManager = require("./secretsManager");

function log(projectId, stage, message, extra = {}) {
  return db.appendLog(projectId, { stage, message, ...extra });
}

/**
 * Runs (or resumes) the pipeline for a project up to the next point that
 * needs the user. Stages:
 *   created -> analyzing -> planning -> (awaiting_confirmation | generating)
 *   -> testing -> verified | failed_checks | generation_not_implemented
 */
async function runPipeline(projectId) {
  let project = db.getProject(projectId);
  if (!project) throw new Error("Unknown project");

  // --- Analyze ---------------------------------------------------------
  project = db.updateProject(projectId, { status: "analyzing" });
  log(projectId, "analyze", "Analyzing request and extracting requirements");
  const requirements = await intentAnalyzer.analyze(project.requestText);
  log(projectId, "analyze", `Detected domain "${requirements.domain}", features: [${requirements.features.join(", ")}]`, {
    mode: requirements.mode,
    llmError: requirements.llmError
  });

  // --- Detect project type + Plan --------------------------------------
  project = db.updateProject(projectId, { status: "planning", requirements });
  const projectTypeInfo = projectTypeDetector.detect(requirements);
  const plan = planner.buildPlan(requirements, projectTypeInfo);
  log(
    projectId,
    "plan",
    `Project type: ${plan.projectTypeLabel} (confidence: ${plan.confidence}). Pages: ${plan.pages.join(", ")}.`
  );
  if (!plan.implemented) {
    log(projectId, "plan", `No generator implemented yet for "${plan.projectTypeLabel}". Stopping honestly instead of faking output.`);
  }

  // --- Evaluate confirmation gates --------------------------------------
  const { pendingConfirmations } = confirmationPolicy.evaluatePlanActions(plan.actions);
  const blocking = pendingConfirmations.filter((c) => c.category !== confirmationPolicy.CATEGORY.NEEDS_CREDENTIAL);
  const credentialNeeds = pendingConfirmations.filter((c) => c.category === confirmationPolicy.CATEGORY.NEEDS_CREDENTIAL);

  project = db.updateProject(projectId, { plan, pendingConfirmations: blocking });

  if (blocking.length > 0) {
    db.updateProject(projectId, { status: "awaiting_confirmation" });
    log(projectId, "confirm", `Paused: ${blocking.length} action(s) require your explicit confirmation before proceeding.`, {
      pending: blocking.map((b) => ({ id: b.id, type: b.type, category: b.category, description: b.description }))
    });
    return db.getProject(projectId);
  }

  return continueAfterConfirmation(projectId, credentialNeeds);
}

async function continueAfterConfirmation(projectId, credentialNeeds = []) {
  let project = db.getProject(projectId);
  const plan = project.plan;

  if (!plan.implemented) {
    db.updateProject(projectId, { status: "generation_not_implemented" });
    log(projectId, "generate", `Cannot generate: no working generator exists yet for "${plan.projectTypeLabel}". This is stated, not silently skipped.`);
    return db.getProject(projectId);
  }

  // --- Generate ----------------------------------------------------------
  db.updateProject(projectId, { status: "generating" });
  log(projectId, "generate", "Generating project files");
  const genResult = codeGenAgent.generateProject(projectId, plan);
  if (!genResult.implemented) {
    db.updateProject(projectId, { status: "generation_not_implemented" });
    log(projectId, "generate", genResult.reason);
    return db.getProject(projectId);
  }
  log(projectId, "generate", `Wrote ${genResult.files.length} file(s): ${genResult.files.map((f) => f.relativePath).join(", ")}`);
  db.updateProject(projectId, { files: genResult.files.map((f) => f.relativePath) });

  // Record which credentials are still needed (for the UI), without
  // blocking preview/build of the parts that don't require them.
  if (credentialNeeds.length > 0) {
    const requiredKeys = [];
    for (const need of credentialNeeds) {
      log(projectId, "credentials", `${need.description} — configure via POST /api/projects/${projectId}/secrets`, {
        note: need.credentialFlow ? need.credentialFlow.note : undefined
      });
    }
  }

  // --- Test / Build --------------------------------------------------------
  db.updateProject(projectId, { status: "testing" });
  log(projectId, "test", "Running install/build/test checks in the sandbox");
  const testResult = await testRunner.runChecks(projectId);
  db.updateProject(projectId, { lastTestResult: testResult });
  for (const step of testResult.steps) {
    log(projectId, "test", `${step.name}: ${step.ok ? "PASS" : "FAIL"}${step.note ? " — " + step.note : ""}`, {
      code: step.code,
      stderr: step.ok ? undefined : step.stderr
    });
  }

  // --- Preview (best-effort, independent of test outcome) -----------------
  try {
    const preview = await previewManager.startPreview(projectId);
    db.updateProject(projectId, { preview });
    log(projectId, "preview", `Preview server running at ${preview.url}`);
  } catch (err) {
    log(projectId, "preview", `Could not start preview: ${err.message}`);
  }

  const finalStatus = testResult.ok ? "verified" : "failed_checks";
  db.updateProject(projectId, { status: finalStatus });
  log(projectId, "done", `Pipeline finished with status: ${finalStatus}`);

  return db.getProject(projectId);
}

async function confirmAction(projectId, actionId, approve) {
  const project = db.getProject(projectId);
  if (!project) throw new Error("Unknown project");
  const action = (project.pendingConfirmations || []).find((a) => a.id === actionId);
  if (!action) throw new Error("No such pending confirmation");

  if (!approve) {
    db.updateProject(projectId, {
      status: "cancelled",
      pendingConfirmations: project.pendingConfirmations.filter((a) => a.id !== actionId)
    });
    log(projectId, "confirm", `User declined: ${action.description}. Stopping — nothing further was executed.`);
    return db.getProject(projectId);
  }

  const remaining = project.pendingConfirmations.filter((a) => a.id !== actionId);
  db.updateProject(projectId, { pendingConfirmations: remaining });
  log(projectId, "confirm", `User approved: ${action.description}`);

  if (remaining.length > 0) {
    return db.getProject(projectId); // still waiting on other confirmations
  }

  return continueAfterConfirmation(projectId, []);
}

module.exports = { runPipeline, confirmAction, continueAfterConfirmation };
