# Confirmation Rules

This documents the exact, fixed rule table enforced by `server/lib/confirmationPolicy.js`. It is not a description of intended behavior — it is a description of the code that runs.

## Categories

| Category | Behavior |
|---|---|
| `SAFE` | Proceeds automatically. No user interaction required. |
| `DESTRUCTIVE` | Pipeline pauses. Requires explicit `approve: true` via `POST /api/projects/:id/confirm`. |
| `COSTS_MONEY` | Same as DESTRUCTIVE — explicit confirmation required before proceeding. |
| `PUBLIC_DEPLOY` | Same — explicit confirmation required before anything is published/deployed. |
| `NEEDS_CREDENTIAL` | Pipeline does **not** block the rest of generation/build/preview, but the required credential is surfaced in the log and via `GET /api/projects/:id/secrets`. Features that need it (e.g. real checkout) stay non-functional and say so until the credential is configured through `POST /api/projects/:id/secrets`. |

Unclassified action types are **fail-closed**: `confirmationPolicy.classify()` defaults anything not explicitly listed to `DESTRUCTIVE`, so a new action type added to the planner without a rule entry will block for confirmation rather than silently running.

## Current rule table

```
SAFE:             generate_files, write_new_file, install_dependencies,
                   run_lint, run_typecheck, run_tests, run_build,
                   start_local_preview, stop_local_preview,
                   modify_existing_file

DESTRUCTIVE:       overwrite_project, delete_project, delete_file,
                    force_reset_workspace, run_database_migration_destructive

COSTS_MONEY:        provision_paid_service, enable_billed_api, purchase_domain

PUBLIC_DEPLOY:      deploy_public, publish_to_app_store, make_repo_public

NEEDS_CREDENTIAL:   configure_third_party_api_key, configure_payment_provider,
                    configure_deployment_target
```

## Verified behavior

An automated test path (exercised manually via the API, see project history) confirmed:
- A request mentioning payments produces a `COSTS_MONEY` pending confirmation and the pipeline halts at `status: awaiting_confirmation` **before any files are generated**.
- Approving that confirmation resumes the pipeline from exactly where it left off.
- Declining sets `status: cancelled` and nothing further executes.

## Credential flow specifically

JOROS never asks for a secret in chat/plan text and never writes one into generated source. The only path to configure a credential is:

```
POST /api/projects/:id/secrets
{ "key": "STRIPE_SECRET_KEY", "value": "..." }
```

The value is written only to `workspaces/<id>/.env` (gitignored) and is never returned by any subsequent API call, including the project's own detail view and log.

## Adding a new action type

1. Add it to the `RULES` table in `confirmationPolicy.js` with an explicit category — do not rely on the fail-closed default as a permanent answer, since it just means "blocks until someone classifies it."
2. If it's `NEEDS_CREDENTIAL`, make sure the planner action includes a `credentialNote` describing exactly which env var to set and why.
