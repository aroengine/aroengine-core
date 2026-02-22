# ARO - Appointment Revenue Optimizer

**Production-grade Node.js/TypeScript application for appointment reminder automation.**

---

## Project Overview

ARO reduces appointment no-shows through automated SMS reminders, confirmation workflows, and risk-based deposit requests.

Documentation model:
- Core platform (domain-agnostic): booking events, reminders, confirmations, no-show recovery, idempotency, retries, rate limits, auth, and audit.
- Vertical Profiles: `healthcare` (current default), with future profiles such as salon, legal consults, coaching, and other appointment-based services.

Phase 1 go-to-market remains healthcare/medical practices via the `healthcare` profile.

### MVP Scope (Phase 1)
1. Booking webhook listener (Calendly)
2. Reminder sequence (48h + 24h)
3. Confirmation classification (LLM-assisted)
4. Post-appointment review request

Note: These are Core platform capabilities and are profile-agnostic. Current examples and compliance overlays are defined for the `healthcare` profile.

### Architecture Contract Baseline (ADR-0006)

Canonical architecture decision:
- `docs/implementation/ADR-0006-core-engine-service-boundaries.md`

Mandatory boundaries:
- `core-engine`: independent stateless service, horizontally scalable
- `profile-backend` (per profile): profile policy/templates/projections + auth/tenant boundary
- `profile-ui` (per profile): profile UX, calls only profile backend
- `openclaw-executor`: internal action runner behind core-engine (side-effect execution only)

Mandatory v1 contracts:
- Command API (`/v1/commands`) with `X-Tenant-Id`, `Idempotency-Key`, `X-Correlation-Id`
- Event API (`/v1/events`) with canonical envelopes and replay support
- Profile Pack interface (additive overlays only; no core schema mutation)
- Core↔OpenClaw execution contract (core-authorized commands in, canonical events out)

Production baseline freeze:
- Current ADR-0006 boundaries/contracts are the production v1 baseline.
- No further integration changes are required unless new features/profile capabilities are added.
- Any non-additive contract/boundary change requires ADR update + contract/replay/idempotency tests + GO/NO-GO signoff.

Integration artifacts shipped:
- ARO Profile Pack (BFF-loaded)
- OpenClaw Skill Pack (Executor-loaded)
- installer/onboarding/update/support layer

Authority model:
- Core Engine is the deterministic authority and system of record.
- OpenClaw Executor is an adapter/governor behind Core Engine.
- OpenClaw runtime is a pluggable execution substrate for authorized side effects only.

### Explicitly Out of Scope (MVP)
- AI upsell engine
- LTV optimization
- Multi-location support
- CRM replacement
- Advanced analytics
- Auto-cancel and auto-charge

---

## Repository Structure

```
apps/
  core-engine/         # Independent stateless orchestration/command service
  profile-backend-healthcare/  # Healthcare BFF (policy + projection layer)
  profile-ui-healthcare/       # Healthcare UI
  openclaw-executor/           # OpenClaw runtime action runner
packages/
  workflow-engine/     # Deterministic workflow orchestration
  integrations/        # External adapters (Calendly, Twilio, Stripe)
  shared/              # Shared types, utilities, validation
docs/
  specs/               # System specifications (read-only reference)
  implementation/      # Implementation plans and work packages
.claude/skills/        # ARO-specific Claude Code skills
```

---

## Critical Production Rules

### 0. Service Boundary Rule (MANDATORY)

- Never place profile-specific business branches inside `core-engine` deterministic logic.
- Profile-specific behavior must be implemented as Profile Pack overlays in profile backends.
- Never allow direct side effects from UI/BFF outside core-authorized command flow.
- OpenClaw executor must emit canonical events; no out-of-band state mutation.
- Any contract change to Command/Event/Profile interfaces requires ADR update + contract tests.
- Any Core↔OpenClaw contract change requires replay/idempotency contract test updates and gate signoff.

### 1. Environment Variables - STRICT REQUIREMENTS

**ALL environment variables must be:**
1. Declared in `.env.example` with documentation
2. Validated at startup with schema validation
3. NEVER have fallback values in code

```typescript
// WRONG - NO FALLBACKS
const port = process.env.PORT || 3000;

// CORRECT - Fail fast on missing config
const port = config.PORT;  // Throws if not defined

// CORRECT - Schema validation at startup
const configSchema = z.object({
  PORT: z.string().regex(/^\d+$/).transform(Number),
  DATABASE_URL: z.string().url(),
  JWT_SECRET: z.string().min(32),
  // ... all env vars must be declared
});

// Parse and validate ONCE at startup
export const config = configSchema.parse(process.env);
```

### 2. Config Validation Pattern

```typescript
// src/config/index.ts
import { z } from 'zod';

const configSchema = z.object({
  // Server
  NODE_ENV: z.enum(['development', 'test', 'staging', 'production']),
  PORT: z.string().regex(/^\d+$/).transform(Number),
  HOST: z.string().min(1),

  // Database
  DATABASE_URL: z.string().url(),
  DATABASE_POOL_MIN: z.string().regex(/^\d+$/).transform(Number).default('2'),
  DATABASE_POOL_MAX: z.string().regex(/^\d+$/).transform(Number).default('10'),

  // Security
  JWT_SECRET: z.string().min(32),
  ENCRYPTION_KEY: z.string().length(64),  // 32 bytes hex-encoded
  ENCRYPTION_SALT: z.string().min(16),

  // Integrations
  CALENDLY_API_KEY: z.string().startsWith('Bearer '),
  CALENDLY_WEBHOOK_SECRET: z.string().min(32),
  TWILIO_ACCOUNT_SID: z.string().startsWith('AC'),
  TWILIO_AUTH_TOKEN: z.string().length(32),
  TWILIO_PHONE_NUMBER: z.string().regex(/^\+\d{10,15}$/),
  STRIPE_SECRET_KEY: z.string().startsWith('sk_'),
  STRIPE_WEBHOOK_SECRET: z.string().startsWith('whsec_'),

  // LLM (for classification only)
  LLM_API_KEY: z.string().min(1),
  LLM_MODEL: z.string().min(1),
  LLM_MAX_TOKENS: z.string().regex(/^\d+$/).transform(Number).default('50'),
  LLM_TEMPERATURE: z.string().regex(/^[\d.]+$/).transform(Number).default('0.1'),
});

export type Config = z.infer<typeof configSchema>;

function loadConfig(): Config {
  try {
    return configSchema.parse(process.env);
  } catch (error) {
    if (error instanceof z.ZodError) {
      const missing = error.errors.map(e => `${e.path.join('.')}: ${e.message}`);
      throw new Error(`Configuration errors:\n${missing.join('\n')}`);
    }
    throw error;
  }
}

export const config = loadConfig();
```

### 3. No Optional Environment Variables at Runtime

```typescript
// WRONG - undefined creates silent failures
const webhookSecret = process.env.WEBHOOK_SECRET ?? 'default';

// CORRECT - fail at startup, not in production
const webhookSecret = config.WEBHOOK_SECRET;
```

---

## Contributor Identity Policy

**MANDATORY:** All commits and pushes MUST use the GitHub user `pyellamaraju`.

- Never use `pyaichatbot` for commits, pushes, or PR authorship.
- Before any commit/push, ensure local git identity is set to `pyellamaraju`.
- If an incorrect identity is used, amend/rebase to correct authorship before pushing.

Recommended setup:

```bash
git config user.name "pyellamaraju"
git config user.email "pyellamaraju@users.noreply.github.com"
```

---

## Local CI Gate (MANDATORY)

**Before EVERY push to ANY remote:**

```bash
npm run lint && npm run typecheck && npm run test && npm run test:integration
```

### Enforcement
- Block push if any command fails
- Re-run after rebasing from main
- No exceptions for "small changes"
- Remote CI is still required

### Git Hook Setup
```bash
# One-time setup
./scripts/install-git-hooks.sh
```

---

## Technology Stack

| Layer | Technology |
|-------|------------|
| Runtime | Node.js 20 LTS |
| Language | TypeScript strict mode |
| Framework | Fastify (preferred) or Express |
| Database | PostgreSQL or SQLite (with SQLCipher) |
| Validation | Zod |
| Testing | Vitest |
| Logging | Pino (structured JSON) |
| Linting | ESLint + @typescript-eslint |

### TypeScript Strict Configuration

```json
{
  "compilerOptions": {
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitReturns": true,
    "noFallthroughCasesInSwitch": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "exactOptionalPropertyTypes": true,
    "noPropertyAccessFromIndexSignature": true
  }
}
```

---

## Coding Standards

### Deterministic First, LLM Last

LLM is ONLY for communication classification and content tone. Never for business logic.

```typescript
// CORRECT - Deterministic business logic
function calculateRiskScore(customer: Customer): number {
  let score = 0;
  score += Math.min(customer.noShowCount * 20, 40);  // 40% weight
  score += (1 - customer.confirmationRate) * 30;      // 30% weight
  score += (customer.rescheduleCount / customer.totalAppointments) * 20;  // 20% weight
  if (customer.hasPastDuePayment) score += 10;        // 10% weight
  return Math.min(score, 100);
}

// CORRECT - LLM only for communication classification
async function classifyResponse(message: string): Promise<Intent> {
  // First check opt-out keywords (deterministic)
  const optOutKeywords = ['STOP', 'UNSUBSCRIBE', 'CANCEL', 'END', 'QUIT'];
  if (optOutKeywords.some(kw => message.toUpperCase().includes(kw))) {
    return { intent: 'opt_out', confidence: 1.0, source: 'keyword' };
  }

  // Then use LLM for ambiguous cases
  return llm.classify(message, {
    allowedIntents: ['confirm', 'reschedule', 'cancel', 'unclear'],
    maxTokens: 50,
    temperature: 0.1
  });
}
```

### Error Handling - Fail Explicitly

```typescript
// WRONG - Silent failures
try {
  await sendReminder(appointment);
} catch (e) {
  console.error(e);
}

// CORRECT - Structured error handling with context
try {
  await sendReminder(appointment);
} catch (error) {
  logger.error('Failed to send reminder', {
    appointmentId: appointment.id,
    customerId: appointment.customerId,
    error: error instanceof Error ? error.message : 'Unknown error',
    stack: error instanceof Error ? error.stack : undefined
  });

  // Emit event for retry/DLQ
  await events.emit('reminder.failed', {
    appointmentId: appointment.id,
    error: error instanceof Error ? error.message : 'Unknown error',
    timestamp: new Date().toISOString()
  });

  throw error;  // Re-throw for caller to handle
}
```

### Structured Logging

```typescript
import pino from 'pino';

const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  formatters: {
    level: (label) => ({ level: label })
  },
  redact: ['req.headers.authorization', 'req.headers.cookie'],
  serializers: {
    req: pino.stdSerializers.req,
    res: pino.stdSerializers.res,
    err: pino.stdSerializers.err
  }
});

// Usage with correlation IDs
logger.info({
  correlationId: req.id,
  appointmentId: appointment.id,
  action: 'reminder.sent',
  channel: 'sms',
  customerId: appointment.customerId
}, 'Reminder sent successfully');
```

---

## Security Requirements

### 1. Webhook Signature Verification (CRITICAL)

```typescript
// Calendly - HMAC-SHA256
function verifyCalendlySignature(
  payload: string,
  signature: string,
  secret: string
): boolean {
  const expected = crypto
    .createHmac('sha256', secret)
    .update(payload)
    .digest('hex');

  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(expected)
  );
}

// NEVER process unsigned webhooks
app.post('/webhooks/calendly', (req, res) => {
  const signature = req.headers['calendly-webhook-signature'];
  if (!signature || !verifyCalendlySignature(req.rawBody, signature, config.CALENDLY_WEBHOOK_SECRET)) {
    logger.warn('Invalid webhook signature', { ip: req.ip });
    return res.status(401).json({ error: 'Invalid signature' });
  }
  // ... process webhook
});
```

### 2. Encryption at Rest

```typescript
// Sensitive fields MUST be encrypted
const ENCRYPTED_FIELDS = [
  'integrations.*.apiKey',
  'integrations.*.authToken',
  'integrations.*.secretKey'
];

// AES-256-GCM encryption
class FieldEncryption {
  private key: Buffer;

  constructor(encryptionKey: string, encryptionSalt: string) {
    this.key = crypto.pbkdf2Sync(
      encryptionKey,
      encryptionSalt,
      100000,  // iterations
      32,      // key length
      'sha256'
    );
  }

  encrypt(plaintext: string): string {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-gcm', this.key, iv);
    let encrypted = cipher.update(plaintext, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const authTag = cipher.getAuthTag().toString('hex');
    return `${iv.toString('hex')}:${authTag}:${encrypted}`;
  }

  decrypt(ciphertext: string): string {
    const [ivHex, authTagHex, encrypted] = ciphertext.split(':');
    const decipher = crypto.createDecipheriv(
      'aes-256-gcm',
      this.key,
      Buffer.from(ivHex, 'hex')
    );
    decipher.setAuthTag(Buffer.from(authTagHex, 'hex'));
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  }
}
```

### 3. Input Validation with Zod

```typescript
const phoneSchema = z.string().regex(/^\+[1-9]\d{1,14}$/, 'Invalid E.164 phone format');
const emailSchema = z.string().email();

const createAppointmentSchema = z.object({
  customerId: z.string().uuid(),
  date: z.string().datetime(),
  duration: z.number().int().min(15).max(480),
  serviceType: z.string().min(1).max(255),
  serviceCost: z.number().nonnegative(),
  provider: z.string().max(255).optional(),
  notes: z.string().max(1000).optional()
});
```

### 4. SQL Injection Prevention

```typescript
// NEVER concatenate user input into SQL
// WRONG
const query = `SELECT * FROM customers WHERE phone = '${phone}'`;

// CORRECT - Parameterized queries
const query = 'SELECT * FROM customers WHERE phone = ?';
const result = await db.query(query, [phone]);

// CORRECT - Query builder
const customer = await db.customers.where('phone', phone).first();
```

### 5. TCPA Compliance

```typescript
// Check consent before sending SMS
async function sendSMS(customer: Customer, message: string): Promise<void> {
  const consent = await db.consents.findByCustomerId(customer.id);

  if (!consent?.consentGiven || consent.optOutDate) {
    logger.warn('SMS blocked - no consent', { customerId: customer.id });
    throw new Error('Customer has not consented to SMS');
  }

  // Append mandatory opt-out footer
  const fullMessage = `${message}\n\nReply STOP to unsubscribe.`;

  await twilio.send({
    to: customer.phone,
    body: fullMessage
  });
}
```

---

## Guardrails (Hard Constraints)

These are system-level protections that cannot be overridden by configuration:

| Guardrail | Behavior |
|-----------|----------|
| `preventAutoCancellation` | System cannot cancel appointments without human confirmation |
| `preventAutoPayment` | System cannot charge without explicit `userConfirmed: true` |
| `messageRateLimit` | Max 3 messages per customer per 24 hours |
| `preventMedicalAdvice` | LLM output filtered for medical terms (diagnose, prescription, treatment, cure) |

```typescript
const GUARDRAILS = {
  preventAutoCancellation: true,   // NEVER auto-cancel
  preventAutoPayment: true,        // NEVER auto-charge
  messageRateLimit: {
    maxPerDay: 3,
    windowMs: 86400000  // 24 hours
  },
  medicalAdvicePatterns: [
    /\bdiagnos(e|is|tic)\b/i,
    /\bprescript(ion|ive)\b/i,
    /\btreat(ment|ed|ing)\b/i,
    /\bcure(s|d)?\b/i
  ]
};
```

---

## Testing Standards

### Test Organization

```
src/
  __tests__/
    unit/           # Isolated unit tests
    integration/    # Database/API integration
vitest.config.ts
vitest.integration.ts
```

### Coverage Requirements

- Minimum: 80% line coverage
- Critical paths (state machines, payments): 100%

### Test Patterns

```typescript
// Unit test example
describe('calculateRiskScore', () => {
  it('should cap no-show contribution at 40 points', () => {
    const customer = createTestCustomer({ noShowCount: 10 });
    const score = calculateRiskScore(customer);
    const noShowContribution = Math.min(customer.noShowCount * 20, 40);
    expect(score).toBeGreaterThanOrEqual(noShowContribution);
  });
});

// Integration test example
describe('POST /webhooks/calendly', () => {
  it('should reject unsigned webhooks', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/webhooks/calendly',
      payload: { event: 'invitee.created' }
    });
    expect(response.statusCode).toBe(401);
  });
});
```

---

## Work Package Execution

When executing work packages from `docs/implementation/IMPLEMENTATION-WORKPACKAGES.md`:

1. Read the work package completely before starting
2. Identify all dependencies (check `Depends On` field)
3. Review relevant spec sections in `docs/specs/`
4. Implement incrementally with tests
5. Run Local CI Gate before completion
6. Document any deviations from spec

### Work Package Template

```markdown
### WP-XXXX: Title
Phase: X
Priority: P0/P1
Objective: [What this accomplishes]
Depends On: [WP IDs that must complete first]
Inputs (Specs): [Spec file numbers]
Deliverables: [What will be produced]
Tests: [Required tests]
Definition of Done: [Completion criteria]
```

---

## Skills Reference

Use these skills during development:

| Skill | Purpose | When to Use |
|-------|---------|-------------|
| `aro-local-ci-gate` | Run mandatory CI checks | Before every push |
| `aro-typescript-pro` | TypeScript/Node.js best practices | All TypeScript development |
| `aro-secure-coding` | Security implementation | Auth, encryption, validation |
| `aro-database-patterns` | Database patterns | Migrations, repositories |
| `aro-workflow-engine` | Workflow orchestration | State machines, triggers |
| `aro-integration-adapter` | External integrations | Calendly, Twilio, Stripe |
| `aro-resilience-patterns` | Resilience patterns | Circuit breakers, retries |
| `aro-production-gate` | Production readiness | Phase 8 release |
| `aro-work-package-executor` | Execute work packages | Feature implementation |

---

## Definition of Done

A task is complete only when ALL of the following are true:

- [ ] Implementation matches spec requirements
- [ ] Unit tests pass with required coverage
- [ ] Integration tests pass (if cross-module)
- [ ] E2E tests pass (if user-facing)
- [ ] `npm run lint` passes with 0 errors
- [ ] `npm run typecheck` passes with 0 errors
- [ ] Local CI Gate passes completely
- [ ] Security implications reviewed
- [ ] Structured logging added for failure paths
- [ ] Rollback path documented (for schema/runtime changes)

---

## Quick Reference Commands

```bash
# Development
npm run dev                  # Start development server
npm run lint                 # Run linter
npm run lint:fix             # Auto-fix lint issues
npm run typecheck            # TypeScript check
npm run test                 # Unit tests
npm run test:integration     # Integration tests
npm run test:watch           # Watch mode

# CI Gate (MANDATORY before push)
npm run ci:local             # Full local CI gate

# Database
npm run db:migrate           # Run migrations
npm run db:rollback          # Rollback last migration
npm run db:seed              # Seed test data

# Git Hooks
./scripts/install-git-hooks.sh   # Install pre-push hook
```

---

## Forbidden Patterns

### No Environment Fallbacks
```typescript
// FORBIDDEN
const port = process.env.PORT || 3000;
const dbUrl = process.env.DATABASE_URL ?? 'postgres://localhost/aro';

// REQUIRED
const port = config.PORT;
const dbUrl = config.DATABASE_URL;
```

### No Silent Failures
```typescript
// FORBIDDEN
try {
  await riskyOperation();
} catch (e) {
  // Do nothing
}

// REQUIRED
try {
  await riskyOperation();
} catch (error) {
  logger.error('Operation failed', { error: error.message, context: {...} });
  throw error;  // or handle explicitly
}
```

### No Business Logic in LLM
```typescript
// FORBIDDEN - LLM making business decisions
const shouldCancel = await llm.decideIfShouldCancel(appointment);

// REQUIRED - Deterministic logic
function shouldCancel(appointment: Appointment, config: Config): boolean {
  return (
    appointment.status === 'no_show' &&
    appointment.noShowCount >= config.autoCancelThreshold &&
    !GUARDRAILS.preventAutoCancellation  // Guardrail check
  );
}
```

### No Plaintext Secrets
```typescript
// FORBIDDEN
const apiKey = 'sk_live_1234567890';

// REQUIRED
const apiKey = config.STRIPE_SECRET_KEY;  // From encrypted storage
```

---

## Documentation References

| Document | Path | Purpose |
|----------|------|---------|
| System Architecture | `docs/specs/01_system_architecture.md` | Overall system design |
| Data Models | `docs/specs/02_data_models.md` | Schema and entities |
| Workflow Orchestration | `docs/specs/03_workflow_orchestration.md` | State machines, triggers |
| API Integrations | `docs/specs/04_api_integrations.md` | External adapters |
| Deployment | `docs/specs/05_deployment_infrastructure.md` | Infrastructure setup |
| Product Requirements | `docs/specs/06_product_requirements.md` | Feature requirements |
| Security & Compliance | `docs/specs/07_security_compliance.md` | Security controls |
| Implementation Plan | `docs/implementation/IMPLEMENTATION-PLAN.md` | Phase execution |
| Work Packages | `docs/implementation/IMPLEMENTATION-WORKPACKAGES.md` | Task breakdown |
