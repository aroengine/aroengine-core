---
name: aro-secure-coding
description: Implement secure coding practices for ARO including encryption, authentication,
  input validation, and compliance. Based on docs/specs/07_security_compliance.md.
  Use when implementing security controls, handling sensitive data, or building auth
  flows.
---

# ARO Secure Coding Practices

Production-grade security implementation for the Appointment Revenue Optimizer.

## Security Principles

### 1. Defense in Depth
- Multiple layers of security controls
- No single point of failure
- Principle of least privilege
- Fail-safe defaults

### 2. Data Minimization
- Collect only what's necessary
- No PHI in SMS messages
- Optional fields for sensitive data
- Regular data purging

### 3. Transparency
- Clear audit trails
- User data export capability
- Deletion requests honored
- Open about limitations

## Critical Security Controls

### 1. Webhook Signature Verification (CRITICAL)

ALL webhooks MUST be signature-verified. No exceptions.

```typescript
import crypto from 'crypto';

// Calendly webhook verification
function verifyCalendlySignature(
  payload: string,
  signature: string,
  secret: string
): boolean {
  const expectedSignature = crypto
    .createHmac('sha256', secret)
    .update(payload)
    .digest('hex');

  // Timing-safe comparison prevents timing attacks
  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(expectedSignature)
  );
}

// Twilio webhook verification
import twilio from 'twilio';

function verifyTwilioSignature(
  url: string,
  params: Record<string, unknown>,
  signature: string,
  authToken: string
): boolean {
  return twilio.validateRequest(authToken, signature, url, params);
}

// Stripe webhook verification
import Stripe from 'stripe';

function verifyStripeSignature(
  payload: string | Buffer,
  signature: string,
  secret: string
): Stripe.Event {
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

  try {
    return stripe.webhooks.constructEvent(payload, signature, secret);
  } catch (err) {
    throw new AroError(
      ERROR_CODES.UNAUTHORIZED,
      'Invalid webhook signature',
      401
    );
  }
}

// Middleware for webhook endpoints
export function webhookAuthMiddleware(source: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    const signature = req.headers['x-calendly-signature']
      ?? req.headers['x-twilio-signature']
      ?? req.headers['stripe-signature'];

    if (!signature) {
      logger.warn('Missing webhook signature', { source, ip: req.ip });
      return res.status(401).json({ error: 'Missing signature' });
    }

    const secret = getWebhookSecret(source);
    const payload = JSON.stringify(req.body);

    if (!verifyWebhookSignature(source, payload, signature as string, secret)) {
      logger.warn('Invalid webhook signature', { source, ip: req.ip });
      return res.status(401).json({ error: 'Invalid signature' });
    }

    next();
  };
}
```

### 2. Field-Level Encryption

Sensitive configuration fields MUST be encrypted at rest.

```typescript
import crypto from 'crypto';

// Encryption configuration
const ENCRYPTION_CONFIG = {
  algorithm: 'aes-256-gcm',
  keyDerivation: 'pbkdf2',
  iterations: 100000,
  saltLength: 32,
  ivLength: 16,
  authTagLength: 16,
};

class FieldEncryption {
  private readonly key: Buffer;

  constructor(encryptionKey: string, encryptionSalt: string) {
    // Derive key using PBKDF2
    this.key = crypto.pbkdf2Sync(
      encryptionKey,
      encryptionSalt,
      ENCRYPTION_CONFIG.iterations,
      32, // 256 bits
      'sha256'
    );
  }

  encrypt(plaintext: string): string {
    const iv = crypto.randomBytes(ENCRYPTION_CONFIG.ivLength);
    const cipher = crypto.createCipheriv(
      ENCRYPTION_CONFIG.algorithm,
      this.key,
      iv
    );

    let encrypted = cipher.update(plaintext, 'utf8', 'hex');
    encrypted += cipher.final('hex');

    const authTag = cipher.getAuthTag();

    // Format: iv:authTag:encrypted
    return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
  }

  decrypt(ciphertext: string): string {
    const parts = ciphertext.split(':');
    if (parts.length !== 3) {
      throw new Error('Invalid ciphertext format');
    }

    const iv = Buffer.from(parts[0], 'hex');
    const authTag = Buffer.from(parts[1], 'hex');
    const encrypted = parts[2];

    const decipher = crypto.createDecipheriv(
      ENCRYPTION_CONFIG.algorithm,
      this.key,
      iv
    );

    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');

    return decrypted;
  }
}

// Usage
const encryption = new FieldEncryption(
  process.env.ENCRYPTION_KEY!,
  process.env.ENCRYPTION_SALT!
);

// Store encrypted
config.integrations.twilio.authToken = encryption.encrypt(twilioAuthToken);

// Retrieve decrypted
const authToken = encryption.decrypt(config.integrations.twilio.authToken);
```

### 3. Input Validation with Zod

ALL inputs at system boundaries MUST be validated.

```typescript
import { z } from 'zod';

// Phone validation (E.164 format)
export const phoneSchema = z.string().regex(
  /^\+[1-9]\d{1,14}$/,
  'Phone must be in E.164 format (e.g., +15551234567)'
);

// Email validation
export const emailSchema = z.string().email('Invalid email format');

// Appointment creation validation
export const createAppointmentSchema = z.object({
  customerId: z.string().uuid('Invalid customer ID'),
  date: z.string().datetime('Invalid date format'),
  duration: z.number().int().min(15).max(480, 'Duration must be 15-480 minutes'),
  serviceType: z.string().min(1).max(255),
  serviceCost: z.number().nonnegative('Cost must be non-negative'),
  provider: z.string().max(255).optional(),
  notes: z.string().max(1000).optional(),
});

// Webhook payload validation
export const calendlyWebhookSchema = z.object({
  event: z.string(),
  created_at: z.string().datetime(),
  payload: z.object({
    event: z.string(),
    uri: z.string(),
    status: z.string(),
    scheduled_event: z.object({
      start_time: z.string().datetime(),
      end_time: z.string().datetime(),
    }),
    email: emailSchema,
    name: z.string(),
    // ... more fields
  }),
});

// Usage in route
app.post('/api/v1/admin/appointments', async (req, res) => {
  try {
    const validated = createAppointmentSchema.parse(req.body);
    // validated is now typed and safe
    const appointment = await appointmentService.create(validated);
    res.status(201).json(appointment);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        error: {
          code: ERROR_CODES.VALIDATION_ERROR,
          message: 'Validation failed',
          details: error.errors,
        },
      });
    }
    throw error;
  }
});
```

### 4. SQL Injection Prevention

ALWAYS use parameterized queries. NEVER concatenate SQL.

```typescript
// ❌ NEVER DO THIS - SQL Injection vulnerability
const query = `SELECT * FROM customers WHERE phone = '${phone}'`;

// ✅ ALWAYS DO THIS - Parameterized query
const query = 'SELECT * FROM customers WHERE phone = ?';
const result = await db.query(query, [phone]);

// Using Kysely (recommended)
const customer = await db
  .selectFrom('customers')
  .where('phone', '=', phone)
  .selectAll()
  .executeTakeFirst();

// Using Knex
const customer = await knex('customers')
  .where({ phone })
  .first();

// Using Prisma
const customer = await prisma.customer.findFirst({
  where: { phone },
});
```

### 5. XSS Prevention

Sanitize all user-generated content.

```typescript
import DOMPurify from 'isomorphic-dompurify';

// Sanitize user input
function sanitizeInput(input: string): string {
  return DOMPurify.sanitize(input, {
    ALLOWED_TAGS: [],     // No HTML tags allowed
    ALLOWED_ATTR: [],     // No attributes allowed
  });
}

// Apply to all user-generated content
app.post('/api/v1/admin/appointments/:id/notes', async (req, res) => {
  const notes = sanitizeInput(req.body.notes);
  await appointmentService.updateNotes(req.params.id, notes);
  res.json({ success: true });
});

// For API responses, use proper content-type
app.get('/api/v1/appointments/:id', async (req, res) => {
  const appointment = await appointmentService.findById(req.params.id);
  res.json(appointment); // JSON is safe by default
});
```

### 6. Authentication & Session Management

```typescript
import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';

// Password policy
const PASSWORD_POLICY = {
  minLength: 12,
  requireUppercase: true,
  requireLowercase: true,
  requireNumbers: true,
  requireSpecialChars: true,
  maxAge: 90, // days
  preventReuse: 5,
};

function validatePassword(password: string): boolean {
  if (password.length < PASSWORD_POLICY.minLength) return false;
  if (!/[A-Z]/.test(password)) return false;
  if (!/[a-z]/.test(password)) return false;
  if (!/[0-9]/.test(password)) return false;
  if (!/[!@#$%^&*]/.test(password)) return false;

  // Check against common passwords list
  if (isCommonPassword(password)) return false;

  return true;
}

// Session configuration
const SESSION_CONFIG = {
  maxAge: 86400000, // 24 hours
  rolling: true,    // Extend on activity
  secure: true,     // HTTPS only
  httpOnly: true,   // No JS access
  sameSite: 'strict' as const,
};

// JWT configuration
const JWT_CONFIG = {
  algorithm: 'HS256',
  expiresIn: '24h',
  issuer: 'aro-system',
  audience: 'aro-admin',
};

function generateToken(admin: Admin): string {
  return jwt.sign(
    {
      userId: admin.id,
      role: admin.role,
      iat: Math.floor(Date.now() / 1000),
    },
    process.env.JWT_SECRET!,
    JWT_CONFIG
  );
}

function verifyToken(token: string): TokenPayload {
  try {
    return jwt.verify(token, process.env.JWT_SECRET!, {
      algorithms: ['HS256'],
      issuer: 'aro-system',
      audience: 'aro-admin',
    }) as TokenPayload;
  } catch (error) {
    throw new AroError(ERROR_CODES.UNAUTHORIZED, 'Invalid token', 401);
  }
}

// Brute force protection
class BruteForceDetector {
  private attempts: Map<string, number[]> = new Map();

  checkFailedLogin(ip: string): boolean {
    const now = Date.now();
    const attempts = this.attempts.get(ip) || [];

    // Remove attempts older than 15 minutes
    const recentAttempts = attempts.filter(time => now - time < 900000);

    if (recentAttempts.length >= 5) {
      logger.warn('Brute force detected', { ip, attempts: recentAttempts.length });
      return true; // Block this IP
    }

    recentAttempts.push(now);
    this.attempts.set(ip, recentAttempts);
    return false;
  }
}
```

### 7. Audit Logging

Log ALL critical actions for compliance.

```typescript
enum AuditAction {
  // Authentication
  LOGIN_SUCCESS = 'auth.login.success',
  LOGIN_FAILURE = 'auth.login.failure',
  LOGOUT = 'auth.logout',

  // Data access
  CUSTOMER_VIEWED = 'customer.viewed',
  CUSTOMER_CREATED = 'customer.created',
  CUSTOMER_UPDATED = 'customer.updated',
  CUSTOMER_DELETED = 'customer.deleted',

  // Configuration changes
  CONFIG_UPDATED = 'config.updated',
  INTEGRATION_ADDED = 'integration.added',

  // Critical actions
  APPOINTMENT_CANCELLED = 'appointment.cancelled',
  DEPOSIT_REQUESTED = 'deposit.requested',
  MESSAGE_SENT = 'message.sent',
  WORKFLOW_OVERRIDE = 'workflow.override',
}

interface AuditLogEntry {
  id: string;
  timestamp: Date;
  action: AuditAction;
  actor: {
    type: 'admin' | 'system' | 'webhook';
    id: string;
    ip?: string;
  };
  resource: {
    type: string;
    id: string;
  };
  changes?: {
    before: unknown;
    after: unknown;
  };
  metadata: Record<string, unknown>;
}

async function auditLog(entry: Omit<AuditLogEntry, 'id' | 'timestamp'>): Promise<void> {
  const fullEntry: AuditLogEntry = {
    ...entry,
    id: crypto.randomUUID(),
    timestamp: new Date(),
  };

  // Store in database
  await db.auditLogs.create({
    ...fullEntry,
    hash: generateHash(fullEntry), // Tamper detection
  });

  logger.info('Audit log', { action: entry.action, resource: entry.resource });
}

function generateHash(entry: AuditLogEntry): string {
  return crypto
    .createHash('sha256')
    .update(JSON.stringify({ ...entry, hash: undefined }))
    .digest('hex');
}
```

### 8. PHI Protection

Never include Protected Health Information in messages.

```typescript
const PHI_PATTERNS = [
  /\b\d{3}-\d{2}-\d{4}\b/,           // SSN
  /\b[A-Z]{2}\d{6}\b/,               // Medical record numbers
  /diagnosis|condition|treatment/i,  // Medical terms
  /prescription|medication|drug/i,   // Medication terms
];

function detectPHI(message: string): boolean {
  return PHI_PATTERNS.some(pattern => pattern.test(message));
}

function sanitizeMessage(template: string, variables: Record<string, string>): string {
  const message = renderTemplate(template, variables);

  if (detectPHI(message)) {
    logger.warn('PHI detected in message, blocking', { template });
    throw new Error('Message contains potential PHI and cannot be sent via SMS');
  }

  return message;
}

// Safe message templates
const SAFE_TEMPLATES = {
  reminder: 'Hi {name}, reminder about your appointment on {date} at {time}. Reply YES to confirm.',
  // ❌ NOT THIS: 'Hi {name}, reminder about your {diagnosis} treatment on {date}.'
};
```

## Security Checklist

Before any code review or merge:

- [ ] All secrets in environment variables (not code)
- [ ] Webhook signatures verified
- [ ] Input validation on all endpoints
- [ ] SQL uses parameterized queries
- [ ] XSS prevention in place
- [ ] Rate limiting configured
- [ ] Audit logging enabled
- [ ] No PHI in messages
- [ ] Encryption for sensitive fields
- [ ] Error messages don't leak sensitive data
