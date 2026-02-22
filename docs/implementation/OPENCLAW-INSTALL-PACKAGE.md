# OpenClaw Install and Execution

This repository has three OpenClaw-related flows:

1. Upstream OpenClaw source checkout for production integration analysis
2. External OpenClaw runtime (CLI or Gateway) built from upstream source
3. Internal ARO OpenClaw executor service artifact (built from this repo)

Architecture requirement:
- `core-engine` is the deterministic authority and system of record.
- `openclaw-executor` is an adapter + governor for invoking external OpenClaw runtime.
- External OpenClaw runtime is a pluggable side-effect execution substrate, not the source of business truth.

## Source-first OpenClaw Runtime (recommended)

Checkout upstream source locally (already ignored via `.external/`):

```bash
git clone https://github.com/openclaw/openclaw .external/openclaw
```

Build and run Gateway from source:

```bash
cd .external/openclaw
npm install
npm run build
node ./dist/cli/index.js gateway --host 127.0.0.1 --port 4100 --token "$OPENCLAW_GATEWAY_TOKEN"
```

The executor can then call authenticated Gateway API directly (`/tools/invoke`) using deterministic Core command mappings.

## External OpenClaw CLI (alternative)

Install:
```bash
npm i -g openclaw
```

Verify installation:
```bash
openclaw --version
```

Convenience npm scripts:
```bash
npm run openclaw:external:install
npm run openclaw:external:verify
npm run openclaw:external:links
```

Official docs:
- https://openclaw.ai/
- https://docs.openclaw.ai/tools/multi-agent-sandbox-tools
- https://docs.openclaw.ai/tools/skills
- https://docs.openclaw.ai/tools/exec
- https://docs.openclaw.ai/tools/agent-send

## Internal ARO OpenClaw Executor Artifact

The internal executor is our app under `apps/openclaw-executor` and is separate from the external CLI.

## Prerequisites
- Node.js >= 20
- Workspace dependencies installed (`npm install`)

## Build
```bash
npm run openclaw:build
```

## Run locally
```bash
npm run openclaw:start
```

Required environment variables:
- `NODE_ENV`
- `HOST`
- `PORT`
- `OPENCLAW_SHARED_TOKEN`
- `OPENCLAW_PERMISSION_MANIFEST_VERSION`
- `OPENCLAW_ALLOWED_COMMANDS`
- `OPENCLAW_ALLOWED_TENANTS`
- `OPENCLAW_TENANT_RATE_LIMIT_PER_MINUTE`
- `OPENCLAW_IDEMPOTENCY_STORE_FILE`
- `OPENCLAW_OUTBOX_FILE`
- `OPENCLAW_RUNTIME_MODE`
- `OPENCLAW_AGENT_TIMEOUT_SECONDS`

Mode-specific required variables:

- For `OPENCLAW_RUNTIME_MODE=external_cli`:
	- `OPENCLAW_AGENT_ID`
	- `OPENCLAW_AGENT_LOCAL_MODE`

- For `OPENCLAW_RUNTIME_MODE=gateway_tools_invoke`:
	- `OPENCLAW_GATEWAY_URL`
	- `OPENCLAW_GATEWAY_TOKEN`
	- `OPENCLAW_GATEWAY_TOOL_MAPPINGS` (JSON mapping `commandType -> { tool, action? }`)

Execution behavior:
- On each core-authorized `/v1/executions` request, executor uses mode-specific runtime:
	- `external_cli`: invokes `openclaw agent --agent <OPENCLAW_AGENT_ID> --message <serialized-command> --json --timeout <OPENCLAW_AGENT_TIMEOUT_SECONDS>` and adds `--local` when enabled.
	- `gateway_tools_invoke`: performs authenticated HTTP `POST <OPENCLAW_GATEWAY_URL>/tools/invoke` with deterministic command-to-tool mapping.
- Executor enforces tenant boundary controls before runtime invocation:
	- `x-tenant-id` header is mandatory and must match command `tenantId`.
	- tenant must be included in `OPENCLAW_ALLOWED_TENANTS`.
	- per-tenant rate limits enforced via `OPENCLAW_TENANT_RATE_LIMIT_PER_MINUTE`.
- Executor reads authentication token via a secret-provider abstraction (default env-backed provider) to preserve a clean upgrade path to vault-backed retrieval.
- Executor idempotency is persisted to disk via `OPENCLAW_IDEMPOTENCY_STORE_FILE` for restart-safe replay behavior.
- Executor appends normalized events to a persistent outbox file via `OPENCLAW_OUTBOX_FILE` before returning response.
- All authoritative workflow transitions originate in Core Engine; executor normalizes OpenClaw outcomes into canonical events only.

## Create deployable package artifact
```bash
npm run openclaw:package
```

Artifact output:
- `artifacts/openclaw-executor/openclaw-executor-<version>.tgz`

## Deploy artifact
```bash
mkdir -p /opt/aro/openclaw-executor
cd /opt/aro/openclaw-executor
tar -xzf openclaw-executor-<version>.tgz
node dist/index.js
```

## Integration Status and Pending Topics

Current integration status:
- Source-built OpenClaw Gateway integration path is implemented via authenticated `/tools/invoke` in `openclaw-executor`.
- External OpenClaw CLI mode remains available for local fallback and parity testing.
- Core Engine remains authoritative; executor performs only Core-authorized side effects and emits canonical events.

Pending topics for production GO:
- Staging signoff evidence for WP-0650 stabilization (`docs/implementation/WP-0650-STABILIZATION-EVIDENCE.md`).
- Production environment hardening values for executor runtime (allowlist, timeout, gateway auth/token rotation, command-to-tool mappings) per tenant.
- Operational rollout checklist completion (systemd/launchd installer + monitoring/alerts in target environment).
