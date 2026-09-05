"use strict";
/**
 * Confirmation policy.
 *
 * Every planned action gets tagged with a category. Categories map to a
 * fixed rule (never inferred ad hoc by the LLM at runtime, so this can't be
 * prompt-engineered around):
 *
 *   SAFE            -> proceed automatically
 *   DESTRUCTIVE      -> requires explicit user confirmation
 *   COSTS_MONEY      -> requires explicit user confirmation
 *   PUBLIC_DEPLOY    -> requires explicit user confirmation
 *   NEEDS_CREDENTIAL -> pipeline pauses; user must supply the credential via
 *                       the secrets flow (POST /api/projects/:id/secrets).
 *                       JOROS never asks the user to paste a secret into
 *                       chat/source, and the pipeline cannot proceed past
 *                       this gate on its own.
 */

const CATEGORY = Object.freeze({
  SAFE: "SAFE",
  DESTRUCTIVE: "DESTRUCTIVE",
  COSTS_MONEY: "COSTS_MONEY",
  PUBLIC_DEPLOY: "PUBLIC_DEPLOY",
  NEEDS_CREDENTIAL: "NEEDS_CREDENTIAL"
});

const REQUIRES_USER_ACTION = new Set([
  CATEGORY.DESTRUCTIVE,
  CATEGORY.COSTS_MONEY,
  CATEGORY.PUBLIC_DEPLOY,
  CATEGORY.NEEDS_CREDENTIAL
]);

/**
 * Rule table. Each rule is (actionType) -> category. New action types must
 * be classified here explicitly — there is no default-allow: unclassified
 * actions are treated as DESTRUCTIVE (fail closed) until someone adds a
 * real rule for them.
 */
const RULES = {
  "generate_files": CATEGORY.SAFE,
  "write_new_file": CATEGORY.SAFE,
  "install_dependencies": CATEGORY.SAFE,
  "run_lint": CATEGORY.SAFE,
  "run_typecheck": CATEGORY.SAFE,
  "run_tests": CATEGORY.SAFE,
  "run_build": CATEGORY.SAFE,
  "start_local_preview": CATEGORY.SAFE,
  "stop_local_preview": CATEGORY.SAFE,
  "modify_existing_file": CATEGORY.SAFE, // reversible: workspace is git-tracked per project

  "overwrite_project": CATEGORY.DESTRUCTIVE,
  "delete_project": CATEGORY.DESTRUCTIVE,
  "delete_file": CATEGORY.DESTRUCTIVE,
  "force_reset_workspace": CATEGORY.DESTRUCTIVE,
  "run_database_migration_destructive": CATEGORY.DESTRUCTIVE,

  "provision_paid_service": CATEGORY.COSTS_MONEY,
  "enable_billed_api": CATEGORY.COSTS_MONEY,
  "purchase_domain": CATEGORY.COSTS_MONEY,

  "deploy_public": CATEGORY.PUBLIC_DEPLOY,
  "publish_to_app_store": CATEGORY.PUBLIC_DEPLOY,
  "make_repo_public": CATEGORY.PUBLIC_DEPLOY,

  "configure_third_party_api_key": CATEGORY.NEEDS_CREDENTIAL,
  "configure_payment_provider": CATEGORY.NEEDS_CREDENTIAL,
  "configure_deployment_target": CATEGORY.NEEDS_CREDENTIAL
};

function classify(actionType) {
  return RULES[actionType] || CATEGORY.DESTRUCTIVE; // fail closed
}

function needsUserAction(actionType) {
  return REQUIRES_USER_ACTION.has(classify(actionType));
}

/**
 * Given a list of planned actions [{type, description, meta}], split into
 * what can run automatically and what must pause for the user.
 */
function evaluatePlanActions(actions) {
  const autoActions = [];
  const pendingConfirmations = [];
  for (const action of actions) {
    const category = classify(action.type);
    if (REQUIRES_USER_ACTION.has(category)) {
      pendingConfirmations.push({
        id: action.id,
        type: action.type,
        category,
        description: action.description,
        // For NEEDS_CREDENTIAL actions, this tells the user exactly what to
        // configure and where — never "paste your key in chat".
        credentialFlow: category === CATEGORY.NEEDS_CREDENTIAL
          ? { endpoint: "/api/projects/:id/secrets", method: "POST", note: action.credentialNote || null }
          : undefined,
        approved: false
      });
    } else {
      autoActions.push(action);
    }
  }
  return { autoActions, pendingConfirmations };
}

module.exports = { CATEGORY, classify, needsUserAction, evaluatePlanActions };
