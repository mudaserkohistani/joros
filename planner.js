"use strict";
const crypto = require("crypto");

/**
 * Builds a Plan from analyzed requirements + detected project type.
 * The plan's `actions` array is what confirmationPolicy.evaluatePlanActions
 * consumes to decide what runs automatically vs. what pauses for the user.
 */
function buildPlan(requirements, projectTypeInfo) {
  const pages = derivePages(requirements);
  const techStack = deriveTechStack(projectTypeInfo, requirements);
  const milestones = deriveMilestones(requirements, projectTypeInfo);
  const actions = deriveActions(requirements, projectTypeInfo);

  return {
    projectType: projectTypeInfo.type,
    projectTypeLabel: projectTypeInfo.label,
    confidence: projectTypeInfo.confidence,
    implemented: projectTypeInfo.implemented,
    domain: requirements.domain,
    features: requirements.features,
    pages,
    techStack,
    milestones,
    actions
  };
}

function derivePages(requirements) {
  const pages = new Set(["home"]);
  if (requirements.features.includes("menu")) pages.add("menu");
  if (requirements.features.includes("shoppingCart")) pages.add("cart");
  if (requirements.features.includes("contactForm")) pages.add("contact");
  if (requirements.features.includes("adminDashboard")) pages.add("admin");
  if (requirements.features.includes("booking")) pages.add("booking");
  if (requirements.features.includes("blog")) pages.add("blog");
  if (requirements.features.includes("gallery")) pages.add("gallery");
  if (requirements.features.includes("authentication")) {
    pages.add("login");
    pages.add("signup");
  }
  return Array.from(pages);
}

function deriveTechStack(projectTypeInfo, requirements) {
  // MVP note: the generator currently implemented (staticSite) is
  // deliberately zero-dependency HTML/CSS/vanilla JS so it can be built,
  // installed, and tested without network access. A framework-based
  // generator (Next.js/React) is a real, separate generator to add later
  // (see docs/ROADMAP.md) — JOROS does not claim to use React here because
  // it doesn't.
  if (projectTypeInfo.type === "website" || projectTypeInfo.type === "web_app") {
    return {
      frontend: "HTML5 / CSS3 / vanilla JavaScript (no build step)",
      backend: requirements.features.includes("adminDashboard") ? "Static admin view (client-side only in MVP; no server persistence yet)" : "none (static)",
      storage: "none (MVP has no server-side persistence yet)",
      rationale: "Chosen for zero install-time dependencies, fast iteration, and to keep the generated project's own build/test pipeline runnable without network access."
    };
  }
  return { frontend: "not yet implemented for this project type", backend: "not yet implemented", storage: "not yet implemented" };
}

function deriveMilestones(requirements, projectTypeInfo) {
  const m = [
    { id: "foundation", title: "Foundation", description: "Scaffold project structure and base styling" }
  ];
  if (requirements.features.includes("authentication")) {
    m.push({ id: "auth", title: "Authentication", description: "Not implemented in this MVP generator — flagged, not faked" });
  }
  m.push({ id: "core_features", title: "Core Features", description: `Build pages: ${derivePages(requirements).join(", ")}` });
  if (requirements.features.includes("adminDashboard")) {
    m.push({ id: "admin", title: "Admin Dashboard", description: "Client-side admin view of orders/content (no server persistence in MVP)" });
  }
  m.push({ id: "testing", title: "Testing & Build", description: "Run lint/build/test checks in the sandbox" });
  m.push({ id: "preview", title: "Preview", description: "Serve the generated project locally for review" });
  return m;
}

function deriveActions(requirements, projectTypeInfo) {
  const actions = [
    { id: crypto.randomUUID(), type: "generate_files", description: "Generate project source files" },
    { id: crypto.randomUUID(), type: "install_dependencies", description: "Install project dependencies (if any declared)" },
    { id: crypto.randomUUID(), type: "run_lint", description: "Run static checks on generated files" },
    { id: crypto.randomUUID(), type: "run_build", description: "Run the project build script" },
    { id: crypto.randomUUID(), type: "run_tests", description: "Run the project test script" },
    { id: crypto.randomUUID(), type: "start_local_preview", description: "Start a local preview server" }
  ];

  if (requirements.features.includes("payments")) {
    actions.push({
      id: crypto.randomUUID(),
      type: "configure_third_party_api_key",
      description: "Payment processing requires a payment provider secret key (e.g. Stripe secret key) before checkout can actually function",
      credentialNote: "Configure STRIPE_SECRET_KEY via the secrets flow. Generated code will read it from environment configuration only — it will never be written into source or the frontend bundle."
    });
    actions.push({
      id: crypto.randomUUID(),
      type: "enable_billed_api",
      description: "Enabling live payment processing can incur real transaction fees from the payment provider"
    });
  }

  return actions;
}

module.exports = { buildPlan };
