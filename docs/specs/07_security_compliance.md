# Security & Compliance Specification
**Appointment Revenue Optimizer (ARO)**
Version: 1.0
Date: 2026-02-22

## 1. Overview

This document defines security requirements, compliance measures, and operational security practices for ARO.

### 1.1 Core and Vertical Profile Compliance Model

- **Core Platform security controls (domain-agnostic):** auth, encryption, input validation, webhook verification, rate limiting, audit logging, and incident response.
- **Profile overlays:** additional domain-specific compliance controls applied per vertical profile.
- **Current default profile:** `healthcare`, which adds HIPAA/PHI handling constraints on top of Core controls.

### 1.2 Inter-Service Security Boundary (ADR-0006)

- All `profile-backend -> core-engine` calls require service authentication (signed tokens or mTLS).
- `X-Tenant-Id`, `Idempotency-Key`, and `X-Correlation-Id` are mandatory security/traceability headers.
- Core-engine enforces tenant authorization and command validation independent of profile backend assumptions.
- Profile Packs must not contain plaintext secrets or bypass core audit/guardrail hooks.

## 2. Security Principles

### 2.1 Defense in Depth
- Multiple layers of security controls
- No single point of failure
- Principle of least privilege
- Fail-safe defaults

### 2.2 Data Minimization
- Collect only what's necessary
- Optional fields for sensitive data
- Regular data purging

**Healthcare profile overlay**:
- No PHI in SMS messages

### 2.3 Transparency
- Clear audit trails
- User data export capability
- Deletion requests honored
- Open about limitations

## 3. Authentication & Authorization

### 3.1 Admin Dashboard Authentication

**MVP Scope Clarification**:
- MVP supports a single admin user account.
- Multi-user RBAC is explicitly deferred to Phase 2.

**Password Requirements**:
```typescript
interface PasswordPolicy {
  minLength: 12;
  requireUppercase: true;
  requireLowercase: true;
  requireNumbers: true;
  requireSpecialChars: true;
  maxAge: 90;                    // Days
  preventReuse: 5;               // Last N passwords
}

function validatePassword(password: string): boolean {
  if (password.length < 12) return false;
  if (!/[A-Z]/.test(password)) return false;
  if (!/[a-z]/.test(password)) return false;
  if (!/[0-9]/.test(password)) return false;
  if (!/[!@#$%^&*]/.test(password)) return false;
  
  // Check against common passwords list
  if (isCommonPassword(password)) return false;
  
  return true;
}
```

**Session Management**:
```typescript
interface SessionConfig {
  maxAge: 86400000;              // 24 hours
  rolling: true;                 // Extend on activity
  secure: true;                  // HTTPS only
  httpOnly: true;                // No JS access
  sameSite: 'strict';
}

// JWT configuration
const JWT_CONFIG = {
  algorithm: 'HS256',
  expiresIn: '24h',
  issuer: 'aro-system',
  audience: 'aro-admin'
};

function generateToken(admin: Admin): string {
  return jwt.sign(
    {
      userId: admin.id,
      role: admin.role,
      iat: Math.floor(Date.now() / 1000)
    },
    process.env.JWT_SECRET!,
    JWT_CONFIG
  );
}
```

**Multi-Factor Authentication (Optional but Recommended)**:
```bash
# Enable MFA for admin account
aro admin:mfa:enable --method totp

# Generate backup codes
aro admin:mfa:backup-codes --generate

# Require MFA for all admin actions
aro config:set security.mfa_required=true
```

### 3.2 API Authentication

**Webhook Signature Verification** (CRITICAL):
```typescript
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
function verifyTwilioSignature(
  url: string,
  params: Record<string, any>,
  signature: string,
  authToken: string
): boolean {
  const twilio = require('twilio');
  return twilio.validateRequest(authToken, signature, url, params);
}

// Stripe webhook verification
function verifyStripeSignature(
  payload: string,
  signature: string,
  secret: string
): boolean {
  const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
  
  try {
    stripe.webhooks.constructEvent(payload, signature, secret);
    return true;
  } catch (err) {
    return false;
  }
}

// Reject unauthenticated webhooks
app.post('/webhooks/:source', (req, res) => {
  const source = req.params.source;
  const signature = req.headers['x-signature'] || req.headers['stripe-signature'];
  
  if (!verifyWebhookSignature(source, req.body, signature)) {
    logger.warn('Invalid webhook signature', { source, ip: req.ip });
    return res.status(401).json({ error: 'Invalid signature' });
  }
  
  // Process webhook...
});
```

## 4. Data Encryption

### 4.1 Data at Rest

**Sensitive Fields Encryption**:
```typescript
// Fields requiring encryption
const ENCRYPTED_FIELDS = [
  'integrations.*.apiKey',
  'integrations.*.authToken',
  'integrations.*.secretKey'
];

// Encryption configuration
const ENCRYPTION_CONFIG = {
  algorithm: 'aes-256-gcm',
  keyDerivation: 'pbkdf2',
  iterations: 100000,
  saltLength: 32,
  ivLength: 16
};

class FieldEncryption {
  private key: Buffer;
  
  constructor() {
    // Key derived from environment variable
    this.key = crypto.pbkdf2Sync(
      process.env.ENCRYPTION_KEY!,
      process.env.ENCRYPTION_SALT!,
      ENCRYPTION_CONFIG.iterations,
      32,
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
    
    const authTag = cipher.getAuthTag().toString('hex');
    
    // Format: iv:authTag:encrypted
    return `${iv.toString('hex')}:${authTag}:${encrypted}`;
  }
  
  decrypt(ciphertext: string): string {
    const parts = ciphertext.split(':');
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
const encryption = new FieldEncryption();

// Store encrypted
config.integrations.twilio.authToken = encryption.encrypt(twilioAuthToken);

// Retrieve decrypted
const authToken = encryption.decrypt(config.integrations.twilio.authToken);
```

**Key Rotation Procedure (Required)**:
```bash
# Rotate encryption keys using dual-key re-encryption
aro security:rotate-encryption-key \
  --old-key-env ENCRYPTION_KEY_OLD \
  --new-key-env ENCRYPTION_KEY_NEW
```

Rotation policy:
- Frequency: every 90 days (or immediately on suspected compromise)
- Procedure: decrypt with old key, re-encrypt with new key, verify checksums, revoke old key
- Audit: log rotation actor, timestamp, key version metadata

**Database Encryption**:
```bash
# SQLite: Use SQLCipher for encrypted database
npm install @journeyapps/sqlcipher

# PostgreSQL: Enable encryption at rest
ALTER TABLE customers USING pgcrypto;

# Backup encryption
aro db:backup --encrypt --output ~/backups/aro-encrypted.db.gpg
```

### 4.2 Data in Transit

**TLS Configuration**:
```typescript
// Require TLS 1.2 or higher
const tlsOptions = {
  minVersion: 'TLSv1.2',
  ciphers: [
    'ECDHE-ECDSA-AES128-GCM-SHA256',
    'ECDHE-RSA-AES128-GCM-SHA256',
    'ECDHE-ECDSA-AES256-GCM-SHA384',
    'ECDHE-RSA-AES256-GCM-SHA384'
  ].join(':'),
  honorCipherOrder: true
};

// HTTPS server
const httpsServer = https.createServer({
  key: fs.readFileSync(process.env.SSL_KEY_PATH!),
  cert: fs.readFileSync(process.env.SSL_CERT_PATH!),
  ...tlsOptions
}, app);

// Redirect HTTP to HTTPS
app.use((req, res, next) => {
  if (!req.secure && process.env.NODE_ENV === 'production') {
    return res.redirect(`https://${req.headers.host}${req.url}`);
  }
  next();
});
```

**Certificate Management**:
```bash
# Generate self-signed certificate (development)
aro ssl:generate-self-signed

# Use Let's Encrypt (production)
aro ssl:letsencrypt --domain aro.yourdomain.com --email admin@yourdomain.com

# Auto-renewal
aro ssl:auto-renew --enable
```

## 5. Input Validation & Sanitization

### 5.1 API Input Validation

```typescript
import { z } from 'zod';

// Phone number validation
const phoneSchema = z.string().regex(/^\+[1-9]\d{1,14}$/);

// Email validation
const emailSchema = z.string().email();

// Appointment creation validation
const createAppointmentSchema = z.object({
  customerId: z.string().uuid(),
  date: z.string().datetime(),
  duration: z.number().int().min(15).max(480),
  serviceType: z.string().min(1).max(255),
  serviceCost: z.number().nonnegative(),
  provider: z.string().max(255).optional(),
  notes: z.string().max(1000).optional()
});

// Validate incoming requests
app.post('/api/v1/admin/appointments', async (req, res) => {
  try {
    const validated = createAppointmentSchema.parse(req.body);
    // Process validated data...
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          details: error.errors
        }
      });
    }
  }
});
```

### 5.2 SQL Injection Prevention

```typescript
// ALWAYS use parameterized queries
// ❌ NEVER do this:
const query = `SELECT * FROM customers WHERE phone = '${phone}'`;

// ✅ ALWAYS do this:
const query = 'SELECT * FROM customers WHERE phone = ?';
const result = await db.query(query, [phone]);

// Using query builder (safe by default)
const customer = await db.customers.where('phone', phone).first();
```

### 5.3 XSS Prevention

```typescript
import DOMPurify from 'isomorphic-dompurify';

// Sanitize user input before display
function sanitizeInput(input: string): string {
  return DOMPurify.sanitize(input, {
    ALLOWED_TAGS: [],           // No HTML tags
    ALLOWED_ATTR: []            // No attributes
  });
}

// Apply to all user-generated content
app.post('/api/v1/admin/appointments/notes', (req, res) => {
  const notes = sanitizeInput(req.body.notes);
  // Save sanitized notes...
});
```

## 6. Logging & Audit Trail

### 6.1 Audit Log Requirements

**What to Log**:
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
  INTEGRATION_REMOVED = 'integration.removed',
  
  // Critical actions
  APPOINTMENT_CANCELLED = 'appointment.cancelled',
  DEPOSIT_REQUESTED = 'deposit.requested',
  MESSAGE_SENT = 'message.sent',
  SMS_OPT_OUT = 'sms.opt_out',
  WORKFLOW_OVERRIDE = 'workflow.override'
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
    before: any;
    after: any;
  };
  metadata: Record<string, any>;
}

// Log all critical actions
async function auditLog(entry: AuditLogEntry): Promise<void> {
  await db.auditLogs.create({
    ...entry,
    timestamp: new Date(),
    hash: generateHash(entry) // Tamper detection
  });
  
  // Also log to external service (optional)
  if (process.env.EXTERNAL_AUDIT_LOG) {
    await externalAuditService.log(entry);
  }
}
```

### 6.2 Log Retention & Protection

```typescript
// Log retention policy
const LOG_RETENTION = {
  audit_logs: 2555,        // 7 years (regulatory requirement)
  access_logs: 90,         // 90 days
  error_logs: 365,         // 1 year
  debug_logs: 30           // 30 days
};

// Log rotation
const logRotation = {
  maxSize: '20m',
  maxFiles: 30,
  compress: true,
  immutable: true          // Prevent modification
};

// Tamper detection
function generateHash(entry: any): string {
  return crypto
    .createHash('sha256')
    .update(JSON.stringify(entry))
    .digest('hex');
}

function verifyLogIntegrity(entry: AuditLogEntry): boolean {
  const stored = entry.hash;
  const computed = generateHash({ ...entry, hash: undefined });
  return stored === computed;
}
```

## 7. Compliance Requirements

### 7.1 GDPR Compliance

**Data Subject Rights**:

```typescript
// Right to access
async function exportCustomerData(customerId: string): Promise<any> {
  const customer = await db.customers.findById(customerId);
  const appointments = await db.appointments.findByCustomerId(customerId);
  const messages = await db.reminderLogs.findByCustomerId(customerId);
  const events = await db.events.findByEntityId(customerId);
  
  return {
    personal_data: {
      phone: customer.phone,
      email: customer.email,
      name: customer.name,
      created_at: customer.createdAt
    },
    appointments: appointments,
    communications: messages,
    audit_trail: events,
    exported_at: new Date().toISOString()
  };
}

// Right to deletion (Right to be forgotten)
async function deleteCustomerData(customerId: string): Promise<void> {
  // Log deletion request
  await auditLog({
    action: AuditAction.CUSTOMER_DELETED,
    actor: { type: 'admin', id: 'system' },
    resource: { type: 'customer', id: customerId },
    metadata: { reason: 'gdpr_deletion_request' }
  });
  
  // Cascade delete all related data
  await db.transaction(async (trx) => {
    await trx.reminderLogs.deleteByCustomerId(customerId);
    await trx.appointments.deleteByCustomerId(customerId);
    await trx.events.deleteByEntityId(customerId);
    await trx.customers.delete(customerId);
  });
  
  // Confirm deletion
  logger.info('Customer data deleted', { customerId });
}

// Right to rectification
async function updateCustomerData(
  customerId: string,
  updates: Partial<Customer>
): Promise<Customer> {
  const before = await db.customers.findById(customerId);
  const after = await db.customers.update(customerId, updates);
  
  await auditLog({
    action: AuditAction.CUSTOMER_UPDATED,
    actor: { type: 'admin', id: 'system' },
    resource: { type: 'customer', id: customerId },
    changes: { before, after }
  });
  
  return after;
}
```

### 7.2 HIPAA Considerations

**Profile Scope**: This section applies to the `healthcare` profile.

**Not HIPAA-compliant by default** (ARO is not a covered entity), but we take precautions:

```typescript
// PHI detection and prevention
const PHI_PATTERNS = [
  /\b\d{3}-\d{2}-\d{4}\b/,           // SSN
  /\b[A-Z]{2}\d{6}\b/,               // Medical record numbers
  /diagnosis|condition|treatment/i,   // Medical terms
  /prescription|medication|drug/i
];

function detectPHI(message: string): boolean {
  return PHI_PATTERNS.some(pattern => pattern.test(message));
}

// Prevent PHI in messages
function sanitizeMessage(template: string, variables: any): string {
  const message = renderTemplate(template, variables);
  
  if (detectPHI(message)) {
    logger.warn('PHI detected in message, blocking', {
      template,
      detectedPattern: true
    });
    
    throw new Error('Message contains potential PHI and cannot be sent via SMS');
  }
  
  return message;
}

// Safe message templates (no PHI)
const SAFE_TEMPLATES = {
  reminder: "Hi {name}, reminder about your appointment on {date} at {time}. Reply YES to confirm.",
  // ❌ NOT THIS: "Hi {name}, reminder about your {diagnosis} treatment on {date}."
};
```

**Business Associate Agreement (BAA)**:
- Available on request for healthcare customers
- Defines data handling responsibilities
- Limits on data usage and disclosure
- Breach notification procedures

### 7.3 TCPA Compliance

**SMS Consent Tracking**:

```typescript
interface ConsentRecord {
  customerId: string;
  phone: string;
  consentGiven: boolean;
  consentDate: Date;
  consentMethod: 'web_form' | 'verbal' | 'booking_system';
  optOutDate?: Date;
  ipAddress?: string;
}

// Check consent before sending
async function checkSMSConsent(customerId: string): Promise<boolean> {
  const consent = await db.consents.findByCustomerId(customerId);
  
  if (!consent || !consent.consentGiven || consent.optOutDate) {
    logger.warn('No SMS consent for customer', { customerId });
    return false;
  }
  
  return true;
}

// Handle opt-out
async function processOptOut(phone: string, message: string): Promise<void> {
  const optOutKeywords = ['STOP', 'UNSUBSCRIBE', 'CANCEL', 'END', 'QUIT'];
  
  if (optOutKeywords.some(kw => message.toUpperCase().includes(kw))) {
    await db.consents.update({ phone }, {
      consentGiven: false,
      optOutDate: new Date()
    });
    
    // Send confirmation
    await messaging.send({
      to: phone,
      body: "You've been unsubscribed. You will no longer receive messages. Reply START to resubscribe."
    });
    
    // Audit log
    await auditLog({
      action: AuditAction.SMS_OPT_OUT,
      resource: { type: 'customer', phone },
      metadata: { message }
    });
  }
}

// Include opt-out in every message
const messageFooter = "\n\nReply STOP to unsubscribe.";
```

**Persistence Requirement**:
- Consent records must be stored in the `consents` table defined in data models spec.
- Message send path must hard-fail consent checks before outbound delivery.

## 8. Security Monitoring

### 8.1 Intrusion Detection

```typescript
// Detect suspicious patterns
interface SecurityEvent {
  type: 'brute_force' | 'unusual_access' | 'data_exfiltration' | 'privilege_escalation';
  severity: 'low' | 'medium' | 'high' | 'critical';
  details: any;
}

// Brute force detection
class BruteForceDetector {
  private attempts: Map<string, number[]> = new Map();
  
  async checkFailedLogin(ip: string): Promise<boolean> {
    const now = Date.now();
    const attempts = this.attempts.get(ip) || [];
    
    // Remove attempts older than 15 minutes
    const recentAttempts = attempts.filter(time => now - time < 900000);
    
    if (recentAttempts.length >= 5) {
      await this.alertSecurity({
        type: 'brute_force',
        severity: 'high',
        details: { ip, attempts: recentAttempts.length }
      });
      
      return true; // Block this IP
    }
    
    recentAttempts.push(now);
    this.attempts.set(ip, recentAttempts);
    
    return false;
  }
}

// Unusual access patterns
async function detectUnusualAccess(userId: string, ip: string): Promise<void> {
  const recentAccess = await db.accessLogs.findRecent(userId, 7);
  const knownIPs = new Set(recentAccess.map(log => log.ip));
  
  if (!knownIPs.has(ip)) {
    await alertSecurity({
      type: 'unusual_access',
      severity: 'medium',
      details: { userId, ip, knownIPs: Array.from(knownIPs) }
    });
  }
}
```

### 8.2 Security Alerts

```bash
# Configure security alerts
aro security:alerts --email security@example.com --severity critical

# Monitor security events
aro security:events --since 24h

# View blocked IPs
aro security:blocked-ips

# Unblock IP (after verification)
aro security:unblock-ip 192.168.1.100
```

## 9. Incident Response

### 9.1 Security Incident Procedures

**Severity Levels**:
- **P0 (Critical)**: Data breach, system compromise
- **P1 (High)**: Unauthorized access, PHI exposure
- **P2 (Medium)**: Failed intrusion attempt, suspicious activity
- **P3 (Low)**: Security policy violation

**Response Playbook**:

```bash
# P0: Data Breach
1. Immediately isolate affected systems
   aro emergency:isolate
   
2. Preserve evidence
   aro logs:freeze --all
   aro db:snapshot --forensic
   
3. Notify stakeholders
   - Affected customers (within 72 hours per GDPR)
   - Regulatory authorities
   - Insurance provider
   
4. Engage incident response team
   
5. Document everything
   aro incident:create --severity P0 --type data_breach

# P1: Unauthorized Access
1. Lock affected accounts
   aro admin:lock --user <user-id>
   
2. Review audit logs
   aro audit:review --since <incident-time>
   
3. Identify scope of access
   
4. Reset credentials
   aro admin:reset-credentials --all
   
5. Notify affected parties

# P2: Suspicious Activity
1. Review security logs
   aro security:events --type suspicious
   
2. Block suspicious IPs
   aro security:block-ip <ip-address>
   
3. Monitor for escalation
   
4. Update security rules
```

### 9.2 Breach Notification Template

```
Subject: Security Incident Notification - [Date]

Dear [Customer Name],

We are writing to inform you of a security incident that may have affected your data.

What Happened:
[Description of incident]

What Information Was Involved:
[Type of data exposed]

What We're Doing:
- Immediately secured the affected systems
- Engaged security experts to investigate
- Notified relevant authorities
- Implemented additional security measures

What You Should Do:
[Recommended actions for customers]

Questions:
Contact us at security@example.com or call [phone]

We sincerely apologize for this incident and are committed to protecting your data.

[Name]
[Title]
```

## 10. Security Checklist

### 10.0 CI Security Controls (Required)

- Dependency scanning in CI (`npm audit --production` or equivalent SCA)
- Secret scanning in pre-commit and CI (`gitleaks`/`trufflehog`/equivalent)
- Security headers enforced in API runtime (Helmet middleware for Express)
- External penetration test before GA launch (Phase 8 gate)

### 10.1 Pre-Deployment Security Review

- [ ] All secrets stored in environment variables (not code)
- [ ] Database credentials encrypted
- [ ] API keys encrypted at rest
- [ ] TLS enabled for all external connections
- [ ] Webhook signatures verified
- [ ] Input validation on all endpoints
- [ ] SQL injection prevention (parameterized queries)
- [ ] XSS prevention (input sanitization)
- [ ] CSRF protection enabled
- [ ] Rate limiting configured
- [ ] Session security configured
- [ ] Password policy enforced
- [ ] Audit logging enabled
- [ ] Error messages don't leak sensitive data
- [ ] Default credentials changed
- [ ] Unnecessary services disabled
- [ ] Security headers configured
- [ ] Dependency vulnerabilities scanned
- [ ] Penetration testing completed

### 10.2 Operational Security Checklist

- [ ] Regular security updates applied
- [ ] Audit logs reviewed weekly
- [ ] Access logs monitored
- [ ] Failed login attempts reviewed
- [ ] Unusual activity investigated
- [ ] Backups tested monthly
- [ ] Incident response plan updated
- [ ] Security training completed
- [ ] Third-party audits scheduled
- [ ] Compliance requirements verified

---

**Document Control**
- Author: Security Team
- Reviewers: Engineering, Legal, Compliance
- Approval Date: TBD
- Next Review: Quarterly
- Classification: Internal Use Only
