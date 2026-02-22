# API & Integrations Specification
**Appointment Revenue Optimizer (ARO)**
Version: 1.0
Date: 2026-02-22

## 1. Overview

This document specifies all external API integrations, webhooks, internal APIs, and communication protocols required for the ARO system.

### 1.1 Core and Vertical Profile Integration Policy

- Integration contracts in this document are **Core Platform** contracts and remain domain-agnostic.
- The `healthcare` profile is currently the default profile for compliance and messaging overlays.
- Future profiles can add profile-specific templates/policies while reusing the same adapter contracts, idempotency model, resilience controls, and auth/audit requirements.

### 1.2 Core API Contracts (ADR-0006)

Core service interface contracts are stable v1 APIs:

- **Command API** (`POST /v1/commands`, `GET /v1/commands/{id}`)
  - Required headers: `X-Tenant-Id`, `Idempotency-Key`, `X-Correlation-Id`
  - Contract: idempotent command submission for workflow/state transitions

- **Event API** (`GET /v1/events`, subscription/replay endpoints)
  - Canonical event envelope with `eventId`, `eventType`, `tenantId`, `aggregate`, `metadata`
  - Contract: at-least-once delivery, dedupe by `eventId`, ordered per aggregate partition

- **Profile Pack Interface** (loaded by profile backends)
  - Contract: additive policies/templates/command mappings
  - Constraint: must not mutate core command/event schemas

### 1.3 OpenClaw Executor Integration Contract

- OpenClaw Executor consumes Core-authorized execution commands via queue/stream.
- Executor invokes OpenClaw skills from versioned OpenClaw Skill Pack.
- Executor publishes outcomes to Event API canonical envelopes.
- Executor cannot publish profile-specific event schema variants.

Wrapper packaging standard:
- `ARO Profile Pack` (BFF-loaded)
- `OpenClaw Skill Pack` (Executor-loaded)
- installer/update/support operational layer

## 2. Integration Architecture

### 2.1 Integration Layers

```
┌─────────────────────────────────────────┐
│        External Services                │
│  (Booking, Messaging, Payment, Review)  │
└────────────────┬────────────────────────┘
                 │
         ┌───────▼────────┐
         │ Integration    │
         │ Adapters       │
         │ (Normalized)   │
         └───────┬────────┘
                 │
         ┌───────▼────────┐
         │ ARO Core API   │
         │ (Internal)     │
         └───────┬────────┘
                 │
         ┌───────▼────────┐
         │ OpenClaw       │
         │ Skills         │
         └────────────────┘
```

## 3. External Integrations

### 3.1 Booking System Integration

#### 3.1.1 Supported Platforms (Phase 1 - Pick ONE)

**Calendly**
- API Type: REST API
- Authentication: OAuth 2.0 or API Key
- Webhook Support: Yes
- Rate Limits: 1000 requests/hour

**Acuity Scheduling**
- API Type: REST API
- Authentication: API Key
- Webhook Support: Yes
- Rate Limits: 60 requests/minute

**Square Appointments**
- API Type: REST API
- Authentication: OAuth 2.0
- Webhook Support: Yes
- Rate Limits: 10 requests/second

#### 3.1.2 Required Endpoints

**Fetch Appointments**
```http
GET /api/v1/appointments
Authorization: Bearer {token}
Query Parameters:
  - start_date: ISO 8601
  - end_date: ISO 8601
  - status: booked|confirmed|cancelled

Response:
{
  "appointments": [
    {
      "id": "external_id_123",
      "customer": {
        "name": "John Doe",
        "phone": "+15551234567",
        "email": "john@example.com"
      },
      "scheduled_at": "2026-03-15T14:00:00Z",
      "duration": 60,
      "service": "Dental Cleaning",
      "status": "booked"
    }
  ]
}
```

**Update Appointment**
```http
PUT /api/v1/appointments/{id}
Authorization: Bearer {token}
Content-Type: application/json

{
  "status": "confirmed",
  "notes": "Customer confirmed via SMS"
}
```

#### 3.1.3 Webhook Configuration

**Appointment Created**
```json
{
  "event": "appointment.created",
  "timestamp": "2026-02-22T10:00:00Z",
  "data": {
    "appointment_id": "cal_12345",
    "customer": {
      "name": "Jane Smith",
      "phone": "+15559876543",
      "email": "jane@example.com"
    },
    "scheduled_at": "2026-03-20T15:00:00Z",
    "duration": 30,
    "service_type": "Consultation"
  }
}
```

**Appointment Updated**
```json
{
  "event": "appointment.updated",
  "timestamp": "2026-02-22T10:05:00Z",
  "data": {
    "appointment_id": "cal_12345",
    "previous_status": "booked",
    "new_status": "rescheduled",
    "scheduled_at": "2026-03-22T10:00:00Z"
  }
}
```

**Appointment Cancelled**
```json
{
  "event": "appointment.cancelled",
  "timestamp": "2026-02-22T10:10:00Z",
  "data": {
    "appointment_id": "cal_12345",
    "cancelled_by": "customer",
    "cancellation_reason": "Scheduling conflict"
  }
}
```

#### 3.1.4 Integration Adapter

```typescript
interface BookingAdapter {
  // Fetch appointments
  fetchAppointments(params: {
    startDate: Date;
    endDate: Date;
    status?: string;
  }): Promise<Appointment[]>;
  
  // Update appointment
  updateAppointment(id: string, data: {
    status?: string;
    notes?: string;
  }): Promise<Appointment>;
  
  // Handle webhook
  handleWebhook(payload: any): Promise<void>;
  
  // Normalize data
  normalizeAppointment(external: any): Appointment;
}

class CalendlyAdapter implements BookingAdapter {
  async fetchAppointments(params) {
    const response = await this.httpClient.get('/scheduled_events', {
      params: {
        min_start_time: params.startDate.toISOString(),
        max_start_time: params.endDate.toISOString()
      }
    });
    
    return response.data.collection.map(apt => this.normalizeAppointment(apt));
  }
  
  normalizeAppointment(external: any): Appointment {
    return {
      id: generateUUID(),
      externalId: external.uri.split('/').pop(),
      customerId: this.getOrCreateCustomer(external.invitees[0]),
      date: new Date(external.start_time),
      duration: external.duration,
      serviceType: external.event_type.name,
      serviceCost: 0, // Not provided by Calendly
      status: 'booked',
      confirmationReceived: false,
      depositRequired: false,
      depositPaid: false,
      createdAt: new Date(),
      updatedAt: new Date()
    };
  }
}
```

### 3.2 Messaging Integration

#### 3.2.1 Supported Platforms

**Twilio (SMS)**
- API Type: REST API
- Authentication: Account SID + Auth Token
- Rate Limits: varies by account
- Cost: ~$0.0075 per SMS (US)

**WhatsApp Business API (via Twilio)**
- API Type: REST API (Twilio's WhatsApp API)
- Authentication: Account SID + Auth Token
- Rate Limits: varies by account
- Cost: varies by country

#### 3.2.2 Required Endpoints

**Send SMS**
```http
POST /2010-04-01/Accounts/{AccountSid}/Messages.json
Authorization: Basic {base64(AccountSid:AuthToken)}
Content-Type: application/x-www-form-urlencoded

Body:
To=+15551234567
From=+15559876543
Body=Hello! This is a reminder about your appointment tomorrow at 2pm.

Response:
{
  "sid": "SM12345678901234567890123456789012",
  "status": "queued",
  "to": "+15551234567",
  "from": "+15559876543",
  "body": "Hello! This is a reminder...",
  "date_created": "2026-02-22T10:00:00Z"
}
```

**Receive SMS (Webhook)**
```http
POST /webhooks/sms/incoming
Content-Type: application/x-www-form-urlencoded

Body:
MessageSid=SM...
From=+15551234567
To=+15559876543
Body=Yes, I confirm
NumMedia=0
```

**Check Message Status**
```http
GET /2010-04-01/Accounts/{AccountSid}/Messages/{MessageSid}.json
Authorization: Basic {base64(AccountSid:AuthToken)}

Response:
{
  "sid": "SM12345...",
  "status": "delivered",
  "date_sent": "2026-02-22T10:00:05Z",
  "price": "-0.00750",
  "error_code": null
}
```

#### 3.2.3 Messaging Adapter

```typescript
interface MessagingAdapter {
  send(params: {
    to: string;
    body: string;
    channel?: 'sms' | 'whatsapp';
  }): Promise<{
    messageId: string;
    status: string;
    delivered: boolean;
  }>;
  
  getStatus(messageId: string): Promise<{
    status: string;
    delivered: boolean;
    deliveredAt?: Date;
  }>;
  
  handleIncoming(payload: any): Promise<{
    from: string;
    body: string;
    timestamp: Date;
  }>;
}

class TwilioAdapter implements MessagingAdapter {
  async send(params) {
    const response = await this.client.messages.create({
      to: params.to,
      from: params.channel === 'whatsapp' 
        ? `whatsapp:${this.config.phoneNumber}`
        : this.config.phoneNumber,
      body: params.body
    });
    
    return {
      messageId: response.sid,
      status: response.status,
      delivered: response.status === 'sent' || response.status === 'delivered'
    };
  }
  
  async handleIncoming(payload: any) {
    return {
      from: payload.From.replace('whatsapp:', ''),
      body: payload.Body,
      timestamp: new Date()
    };
  }
}
```

### 3.3 Payment Integration

#### 3.3.1 Stripe Payment Links

**Create Payment Link**
```http
POST /v1/payment_links
Authorization: Bearer {secret_key}
Content-Type: application/x-www-form-urlencoded

line_items[0][price_data][currency]=usd
line_items[0][price_data][product_data][name]=Appointment Deposit
line_items[0][price_data][unit_amount]=5000
line_items[0][quantity]=1
metadata[appointment_id]=apt_12345
metadata[customer_id]=cust_67890

Response:
{
  "id": "plink_1234567890",
  "url": "https://buy.stripe.com/test_abc123",
  "active": true,
  "metadata": {
    "appointment_id": "apt_12345",
    "customer_id": "cust_67890"
  }
}
```

**Webhook: Payment Succeeded**
```json
{
  "type": "payment_intent.succeeded",
  "data": {
    "object": {
      "id": "pi_1234567890",
      "amount": 5000,
      "currency": "usd",
      "status": "succeeded",
      "metadata": {
        "appointment_id": "apt_12345",
        "customer_id": "cust_67890"
      }
    }
  }
}
```

#### 3.3.2 Payment Adapter

```typescript
interface PaymentAdapter {
  createPaymentLink(params: {
    amount: number;
    currency: string;
    description: string;
    metadata: Record<string, string>;
  }): Promise<{
    linkId: string;
    url: string;
  }>;
  
  handleWebhook(payload: any): Promise<{
    paymentId: string;
    status: string;
    metadata: Record<string, string>;
  }>;
}

class StripeAdapter implements PaymentAdapter {
  async createPaymentLink(params) {
    const paymentLink = await this.stripe.paymentLinks.create({
      line_items: [{
        price_data: {
          currency: params.currency,
          product_data: {
            name: params.description
          },
          unit_amount: params.amount
        },
        quantity: 1
      }],
      metadata: params.metadata
    });
    
    return {
      linkId: paymentLink.id,
      url: paymentLink.url
    };
  }
  
  async handleWebhook(payload: any) {
    const event = this.stripe.webhooks.constructEvent(
      payload.body,
      payload.signature,
      this.config.webhookSecret
    );
    
    if (event.type === 'payment_intent.succeeded') {
      return {
        paymentId: event.data.object.id,
        status: 'succeeded',
        metadata: event.data.object.metadata
      };
    }
    
    throw new Error(`Unhandled event type: ${event.type}`);
  }
}
```

### 3.4 Review Platform Integration (Optional)

#### 3.4.1 Google My Business

**Generate Review Link**
```typescript
function generateGoogleReviewLink(placeId: string): string {
  return `https://search.google.com/local/writereview?placeid=${placeId}`;
}
```

#### 3.4.2 Review Request Flow

```typescript
async function sendReviewRequest(customerId: string, appointmentId: string) {
  const customer = await db.customers.findById(customerId);
  const config = await db.businessConfig.findOne();
  
  const reviewLink = generateGoogleReviewLink(config.googlePlaceId);
  
  const message = `Hi ${customer.name}, thank you for visiting us! We'd love to hear about your experience: ${reviewLink}`;
  
  await messaging.send({
    to: customer.phone,
    body: message
  });
}
```

## 4. Internal APIs

### 4.1 Admin Dashboard API

#### 4.1.1 REST API Endpoints

**List Appointments**
```http
GET /api/v1/admin/appointments
Authorization: Bearer {admin_token}
Query Parameters:
  - status: booked|confirmed|cancelled|no_show|completed
  - date_from: ISO 8601
  - date_to: ISO 8601
  - customer_id: UUID
  - page: number
  - limit: number

Response:
{
  "appointments": [...],
  "pagination": {
    "total": 150,
    "page": 1,
    "limit": 20,
    "pages": 8
  }
}
```

**Get Appointment Details**
```http
GET /api/v1/admin/appointments/{id}
Authorization: Bearer {admin_token}

Response:
{
  "appointment": {
    "id": "...",
    "customer": {...},
    "date": "...",
    "status": "...",
    "reminders": [...],
    "workflows": [...]
  }
}
```

**Update Appointment**
```http
PUT /api/v1/admin/appointments/{id}
Authorization: Bearer {admin_token}
Content-Type: application/json

{
  "status": "confirmed",
  "notes": "Manually confirmed by admin"
}
```

**Get Metrics**
```http
GET /api/v1/admin/metrics
Authorization: Bearer {admin_token}
Query Parameters:
  - period: day|week|month|year
  - date_from: ISO 8601
  - date_to: ISO 8601

Response:
{
  "metrics": {
    "total_appointments": 150,
    "no_show_count": 5,
    "no_show_rate": 0.033,
    "confirmation_rate": 0.85,
    "revenue_saved": 4500.00,
    "messages_sent": 320,
    "response_rate": 0.68
  }
}
```

**List Customers**
```http
GET /api/v1/admin/customers
Authorization: Bearer {admin_token}
Query Parameters:
  - risk_category: low|medium|high
  - search: string (phone, email, name)
  - page: number
  - limit: number

Response:
{
  "customers": [...],
  "pagination": {...}
}
```

**Get Customer Details**
```http
GET /api/v1/admin/customers/{id}
Authorization: Bearer {admin_token}

Response:
{
  "customer": {
    "id": "...",
    "phone": "...",
    "email": "...",
    "riskScore": 25,
    "riskCategory": "low",
    "appointments": [...],
    "lifetime_value": 450.00
  }
}
```

#### 4.1.2 WebSocket API (Real-time Updates)

```typescript
// Connect
const ws = new WebSocket('ws://localhost:3000/api/v1/admin/ws');

// Authentication
ws.send(JSON.stringify({
  type: 'auth',
  token: 'admin_token_here'
}));

// Subscribe to events
ws.send(JSON.stringify({
  type: 'subscribe',
  channels: ['appointments', 'workflows', 'alerts']
}));

// Receive events
ws.onmessage = (event) => {
  const data = JSON.parse(event.data);
  
  switch (data.type) {
    case 'appointment.created':
      // Handle new appointment
      break;
    case 'reminder.sent':
      // Handle reminder sent
      break;
    case 'alert':
      // Handle admin alert
      break;
  }
};
```

### 4.2 Skill API (Internal)

```typescript
interface SkillContext {
  // Database access
  db: {
    customers: Repository<Customer>;
    appointments: Repository<Appointment>;
    events: Repository<Event>;
    // ...
  };
  
  // External services
  messaging: MessagingAdapter;
  booking: BookingAdapter;
  payment: PaymentAdapter;
  
  // LLM access
  llm: {
    complete(params: {
      prompt: string;
      temperature?: number;
      maxTokens?: number;
    }): Promise<{ text: string }>;
  };
  
  // Template rendering
  templates: {
    render(name: string, variables: Record<string, any>): string;
  };
  
  // Configuration
  config: BusinessConfig;
  
  // Event emitter
  events: {
    emit(type: string, data: any): Promise<void>;
  };
  
  // Skill parameters
  params: Record<string, any>;
}

interface SkillResult {
  success: boolean;
  data?: any;
  error?: {
    code: string;
    message: string;
  };
}

interface Skill {
  name: string;
  version: string;
  description: string;
  inputs: Record<string, string>;
  outputs: Record<string, string>;
  run(context: SkillContext): Promise<SkillResult>;
}
```

## 5. Webhook Management

### 5.0 Idempotency Key Contract (Mandatory)

Every inbound webhook must provide a deterministic idempotency key:
- Preferred: provider event ID (e.g., Stripe `event.id`, Twilio `MessageSid`)
- Fallback: `sha256(source + stable_payload_fields + timestamp_bucket)`

Store key before processing side effects:

```sql
CREATE TABLE idempotency_keys (
  key VARCHAR(255) PRIMARY KEY,
  source VARCHAR(50) NOT NULL,
  payload_hash VARCHAR(128) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  expires_at TIMESTAMP NOT NULL
);
```

Retention:
- Default TTL: 7 days
- Cleanup: scheduled daily purge of expired rows

### 5.1 Webhook Receiver

```typescript
class WebhookReceiver {
  async handle(req: Request, res: Response) {
    const { source, signature } = req.headers;
    
    // Verify signature
    if (!this.verifySignature(source, signature, req.body)) {
      return res.status(401).json({ error: 'Invalid signature' });
    }
    
    // Queue webhook for processing
    await this.queue.add('webhooks', {
      source,
      payload: req.body,
      receivedAt: new Date()
    });
    
    // Acknowledge immediately
    res.status(200).json({ received: true });
  }
  
  private verifySignature(source: string, signature: string, body: any): boolean {
    const adapter = this.getAdapter(source);
    return adapter.verifySignature(signature, body);
  }
}
```

### 5.2 Webhook Processing Queue

```typescript
class WebhookProcessor {
  async process(job: WebhookJob) {
    const { source, payload } = job.data;
    const adapter = this.getAdapter(source);
    const idemKey = adapter.getIdempotencyKey(payload);

    const exists = await this.db.idempotencyKeys.exists(idemKey);
    if (exists) {
      return; // duplicate delivery, no-op
    }

    await this.db.idempotencyKeys.create({
      key: idemKey,
      source,
      payloadHash: this.hashPayload(payload),
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
    });
    
    try {
      // Normalize webhook data
      const event = await adapter.handleWebhook(payload);
      
      // Store event
      await this.db.events.create(event);
      
      // Trigger workflows
      await this.triggerEngine.handle(event);
      
    } catch (error) {
      // Retry logic
      if (job.attemptsMade < 3) {
        throw error; // Will retry
      } else {
        // Send to dead letter queue
        await this.dlq.add(job.data);
      }
    }
  }
}
```

## 6. API Security

### 6.1 Authentication

**Admin API**: Bearer token (JWT)
```typescript
const token = jwt.sign(
  { userId: admin.id, role: 'admin' },
  process.env.JWT_SECRET,
  { expiresIn: '24h' }
);
```

**Webhook Verification**: HMAC signatures
```typescript
function verifyWebhookSignature(payload: string, signature: string, secret: string): boolean {
  const expectedSignature = crypto
    .createHmac('sha256', secret)
    .update(payload)
    .digest('hex');
  
  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(expectedSignature)
  );
}
```

### 6.2 Rate Limiting

```typescript
const rateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  message: 'Too many requests from this IP'
});

app.use('/api/', rateLimiter);
```

### 6.3 API Key Encryption

```typescript
function encryptApiKey(apiKey: string): string {
  const iv = crypto.randomBytes(16);
  const key = crypto.scryptSync(process.env.ENCRYPTION_KEY, 'aro', 32);
  const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
  let encrypted = cipher.update(apiKey, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  return `${iv.toString('hex')}:${encrypted}`;
}

function decryptApiKey(encrypted: string): string {
  const [ivHex, body] = encrypted.split(':');
  const iv = Buffer.from(ivHex, 'hex');
  const key = crypto.scryptSync(process.env.ENCRYPTION_KEY, 'aro', 32);
  const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
  let decrypted = decipher.update(body, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}
```

## 7. Resilience & Error Handling

### 7.1 Circuit Breaker Pattern

**Why**: External APIs (Twilio, Stripe, Calendly) can fail. Without circuit breakers, we'd hammer failing services, waste resources, and delay error detection.

**Implementation**:
```typescript
interface CircuitBreakerConfig {
  failureThreshold: number;      // Open after N failures
  successThreshold: number;      // Close after N successes
  timeout: number;               // Half-open timeout (ms)
  monitoringPeriod: number;      // Rolling window (ms)
}

const CIRCUIT_BREAKERS: Record<string, CircuitBreakerConfig> = {
  // Critical: Messaging must work for reminders
  messaging: {
    failureThreshold: 5,          // Open after 5 failures
    successThreshold: 2,          // Close after 2 successes
    timeout: 60000,               // Try again after 1 minute
    monitoringPeriod: 300000      // 5 minute rolling window
  },
  
  // Important but not critical: Booking sync can wait
  booking: {
    failureThreshold: 10,
    successThreshold: 3,
    timeout: 120000,              // Try again after 2 minutes
    monitoringPeriod: 600000      // 10 minute rolling window
  },
  
  // Payment links are synchronous user actions
  payment: {
    failureThreshold: 3,
    successThreshold: 2,
    timeout: 30000,               // Try again after 30 seconds
    monitoringPeriod: 180000      // 3 minute rolling window
  }
};

class CircuitBreaker {
  private state: 'CLOSED' | 'OPEN' | 'HALF_OPEN' = 'CLOSED';
  private failures: number = 0;
  private successes: number = 0;
  private lastFailureTime: Date | null = null;
  
  async execute<T>(
    fn: () => Promise<T>,
    config: CircuitBreakerConfig
  ): Promise<T> {
    // If circuit is OPEN, fail fast
    if (this.state === 'OPEN') {
      const timeSinceFailure = Date.now() - this.lastFailureTime!.getTime();
      
      if (timeSinceFailure < config.timeout) {
        throw new Error('Circuit breaker is OPEN - service unavailable');
      }
      
      // Timeout elapsed, try HALF_OPEN
      this.state = 'HALF_OPEN';
      this.successes = 0;
    }
    
    try {
      const result = await fn();
      this.onSuccess(config);
      return result;
    } catch (error) {
      this.onFailure(config);
      throw error;
    }
  }
  
  private onSuccess(config: CircuitBreakerConfig): void {
    this.failures = 0;
    
    if (this.state === 'HALF_OPEN') {
      this.successes++;
      
      if (this.successes >= config.successThreshold) {
        this.state = 'CLOSED';
        this.successes = 0;
      }
    }
  }
  
  private onFailure(config: CircuitBreakerConfig): void {
    this.failures++;
    this.lastFailureTime = new Date();
    
    if (this.failures >= config.failureThreshold) {
      this.state = 'OPEN';
      
      // Alert admin - critical service down
      this.notifyAdmin({
        service: 'external_api',
        state: 'OPEN',
        failures: this.failures
      });
    }
  }
  
  getState(): string {
    return this.state;
  }
}

// Usage in adapters
class TwilioAdapter implements MessagingAdapter {
  private circuitBreaker = new CircuitBreaker();
  
  async send(params: MessageParams) {
    return this.circuitBreaker.execute(
      () => this.client.messages.create(params),
      CIRCUIT_BREAKERS.messaging
    );
  }
}
```

**State Persistence Requirement**:
- Persist breaker state (`state`, `failures`, `successes`, `lastFailureTime`) to storage every state transition.
- On service startup, restore persisted state before accepting traffic.
- If persistence unavailable, start in `HALF_OPEN` and emit warning event.

### 7.2 Rate Limiting Strategy

**Why**: Prevent abuse, respect third-party limits, protect business from message spam costs.

#### 7.2.1 Outbound Rate Limits (Third-Party APIs)

```typescript
interface RateLimitConfig {
  requests: number;
  period: number;              // milliseconds
  burst: number;               // max burst above limit
}

const API_RATE_LIMITS: Record<string, RateLimitConfig> = {
  // Twilio: Respect their limits + our cost control
  twilio_sms: {
    requests: 60,              // 60 messages
    period: 60000,             // per minute
    burst: 10                  // allow 10 burst
  },
  
  // Calendly: Conservative to avoid hitting their limits
  calendly: {
    requests: 100,
    period: 3600000,           // per hour
    burst: 20
  },
  
  // Stripe: Payment links are low frequency
  stripe: {
    requests: 100,
    period: 1000,              // per second
    burst: 5
  }
};

// Important: provider/API limits and customer communication caps are separate controls.
// - API limits protect upstream quotas and service stability.
// - Per-customer caps (e.g., max 3/day) enforce business guardrails and TCPA-friendly behavior.

class RateLimiter {
  private tokens: number;
  private lastRefill: Date;
  
  constructor(private config: RateLimitConfig) {
    this.tokens = config.requests;
    this.lastRefill = new Date();
  }
  
  async acquire(): Promise<void> {
    this.refill();
    
    if (this.tokens <= 0) {
      const waitTime = this.getWaitTime();
      await this.sleep(waitTime);
      this.refill();
    }
    
    this.tokens--;
  }
  
  private refill(): void {
    const now = Date.now();
    const timePassed = now - this.lastRefill.getTime();
    const periods = Math.floor(timePassed / this.config.period);
    
    if (periods > 0) {
      this.tokens = Math.min(
        this.config.requests + this.config.burst,
        this.tokens + (periods * this.config.requests)
      );
      this.lastRefill = new Date();
    }
  }
  
  private getWaitTime(): number {
    const timeSinceRefill = Date.now() - this.lastRefill.getTime();
    return this.config.period - timeSinceRefill;
  }
  
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// Usage
const twilioLimiter = new RateLimiter(API_RATE_LIMITS.twilio_sms);

async function sendMessage(params: MessageParams) {
  await twilioLimiter.acquire();
  return await twilioAdapter.send(params);
}
```

**Persistence Options**:
- MVP single-instance: SQLite-backed token buckets
- Cloud/multi-instance: Redis-backed shared token buckets
- On restart, limiter state must be restored to avoid burst bypass

#### 7.2.2 Inbound Rate Limits (Protect Our API)

```typescript
// Prevent abuse of admin API and webhooks
const INBOUND_RATE_LIMITS = {
  admin_api: {
    windowMs: 15 * 60 * 1000,  // 15 minutes
    max: 100,                   // 100 requests per IP
    message: 'Too many requests from this IP'
  },
  
  webhook_endpoints: {
    windowMs: 60 * 1000,        // 1 minute
    max: 60,                    // 60 webhooks per source
    message: 'Webhook rate limit exceeded'
  },
  
  // CRITICAL: Prevent customer message spam
  customer_messages: {
    perCustomer: 3,             // Max 3 messages
    period: 86400000,           // per day
    escalate: true              // Alert admin if hit
  }
};

// Express middleware
import rateLimit from 'express-rate-limit';

const adminRateLimiter = rateLimit({
  windowMs: INBOUND_RATE_LIMITS.admin_api.windowMs,
  max: INBOUND_RATE_LIMITS.admin_api.max,
  message: INBOUND_RATE_LIMITS.admin_api.message,
  standardHeaders: true,
  legacyHeaders: false
});

app.use('/api/v1/admin', adminRateLimiter);

// Customer message rate limit (business logic)
async function checkCustomerMessageLimit(customerId: string): Promise<boolean> {
  const config = INBOUND_RATE_LIMITS.customer_messages;
  const sentToday = await db.reminderLogs.count({
    customerId,
    sentAt: { $gte: new Date(Date.now() - config.period) }
  });
  
  if (sentToday >= config.perCustomer) {
    if (config.escalate) {
      await notifyAdmin({
        type: 'rate_limit_hit',
        customerId,
        messagesAttempted: sentToday + 1,
        limit: config.perCustomer
      });
    }
    return false;
  }
  
  return true;
}
```

### 7.3 API Error Responses

```typescript
interface ApiError {
  error: {
    code: string;
    message: string;
    details?: any;
    retryAfter?: number;       // For rate limits
  };
}

// Standard error codes
const ERROR_CODES = {
  // Client errors (4xx)
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  APPOINTMENT_NOT_FOUND: 'APPOINTMENT_NOT_FOUND',
  UNAUTHORIZED: 'UNAUTHORIZED',
  RATE_LIMIT_EXCEEDED: 'RATE_LIMIT_EXCEEDED',
  
  // Server errors (5xx)
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',
  CIRCUIT_BREAKER_OPEN: 'CIRCUIT_BREAKER_OPEN',
  EXTERNAL_API_ERROR: 'EXTERNAL_API_ERROR'
};

// Example error responses
{
  "error": {
    "code": "APPOINTMENT_NOT_FOUND",
    "message": "Appointment with ID apt_123 not found"
  }
}

{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Invalid request parameters",
    "details": {
      "phone": "Must be in E.164 format",
      "date": "Must be a future date"
    }
  }
}

{
  "error": {
    "code": "RATE_LIMIT_EXCEEDED",
    "message": "Too many requests. Please retry after 60 seconds.",
    "retryAfter": 60
  }
}

{
  "error": {
    "code": "CIRCUIT_BREAKER_OPEN",
    "message": "Messaging service temporarily unavailable. Please try again later.",
    "retryAfter": 120
  }
}
```

### 7.4 Retry Strategy for External APIs

```typescript
interface RetryConfig {
  maxAttempts: number;
  backoffStrategy: 'fixed' | 'exponential' | 'linear';
  initialDelay: number;
  maxDelay: number;
  retryableErrors: string[];
}

const RETRY_CONFIGS: Record<string, RetryConfig> = {
  // Messaging: Aggressive retries (critical for reminders)
  messaging: {
    maxAttempts: 5,
    backoffStrategy: 'exponential',
    initialDelay: 500,
    maxDelay: 30000,
    retryableErrors: ['NETWORK_ERROR', 'TIMEOUT', 'RATE_LIMIT', '503', '429']
  },
  
  // Booking: Moderate retries (important but not time-critical)
  booking: {
    maxAttempts: 3,
    backoffStrategy: 'exponential',
    initialDelay: 1000,
    maxDelay: 60000,
    retryableErrors: ['NETWORK_ERROR', 'TIMEOUT', '503', '502']
  },
  
  // Payment: Limited retries (user is waiting)
  payment: {
    maxAttempts: 2,
    backoffStrategy: 'linear',
    initialDelay: 2000,
    maxDelay: 5000,
    retryableErrors: ['NETWORK_ERROR', 'TIMEOUT']
  }
};

// Retry policy note:
// - Workflow engine default retries are defined in workflow spec.
// - Integration adapters may use stricter/longer retries per provider SLA.

async function executeWithRetry<T>(
  fn: () => Promise<T>,
  config: RetryConfig,
  context: string
): Promise<T> {
  let lastError: Error;
  
  for (let attempt = 1; attempt <= config.maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      
      // Don't retry if error is not retryable
      if (!isRetryable(error, config.retryableErrors)) {
        throw error;
      }
      
      // Don't retry on last attempt
      if (attempt === config.maxAttempts) {
        throw error;
      }
      
      // Calculate backoff delay
      const delay = calculateBackoff(attempt, config);
      
      // Log retry attempt
      logger.warn('Retrying operation', {
        context,
        attempt,
        maxAttempts: config.maxAttempts,
        delay,
        error: error.message
      });
      
      await sleep(delay);
    }
  }
  
  throw lastError!;
}

function calculateBackoff(attempt: number, config: RetryConfig): number {
  let delay: number;
  
  switch (config.backoffStrategy) {
    case 'fixed':
      delay = config.initialDelay;
      break;
    case 'linear':
      delay = config.initialDelay * attempt;
      break;
    case 'exponential':
      delay = config.initialDelay * Math.pow(2, attempt - 1);
      break;
  }
  
  // Add jitter to prevent thundering herd
  const jitter = Math.random() * 0.1 * delay;
  delay = delay + jitter;
  
  return Math.min(delay, config.maxDelay);
}

function isRetryable(error: any, retryableErrors: string[]): boolean {
  return retryableErrors.some(code => 
    error.code === code || 
    error.statusCode?.toString() === code ||
    error.message?.includes(code)
  );
}
```

### 7.5 Fallback & Degradation Strategy

**Critical Function: Send Reminder**

```typescript
async function sendReminderWithFallback(
  customerId: string,
  appointmentId: string
): Promise<void> {
  const customer = await db.customers.findById(customerId);
  const appointment = await db.appointments.findById(appointmentId);
  
  try {
    // Primary: Send via preferred channel
    await sendViaPreferredChannel(customer, appointment);
    
  } catch (error) {
    if (error.code === 'CIRCUIT_BREAKER_OPEN') {
      // Fallback: Queue for later retry
      await messageQueue.add('reminders', {
        customerId,
        appointmentId,
        scheduledFor: new Date(Date.now() + 300000) // Retry in 5 min
      });
      
      // Alert admin
      await notifyAdmin({
        type: 'reminder_queued',
        reason: 'circuit_breaker_open',
        appointmentId
      });
      
    } else if (error.code === 'RATE_LIMIT_EXCEEDED') {
      // Fallback: Schedule for later
      const retryAfter = error.retryAfter || 60;
      await messageQueue.add('reminders', {
        customerId,
        appointmentId,
        scheduledFor: new Date(Date.now() + retryAfter * 1000)
      });
      
    } else {
      // Unrecoverable error - escalate
      await notifyAdmin({
        type: 'reminder_failed',
        error: error.message,
        appointmentId,
        priority: 'high'
      });
      
      throw error;
    }
  }
}
```

## 8. API Documentation

### 8.1 OpenAPI Specification

Generate OpenAPI 3.0 documentation for all admin APIs:

```yaml
openapi: 3.0.0
info:
  title: ARO Admin API
  version: 1.0.0
  description: Admin dashboard API for Appointment Revenue Optimizer

servers:
  - url: http://localhost:3000/api/v1
    description: Local development
  - url: https://admin.example.com/api/v1
    description: Production

paths:
  /admin/appointments:
    get:
      summary: List appointments
      security:
        - bearerAuth: []
      parameters:
        - in: query
          name: status
          schema:
            type: string
            enum: [booked, confirmed, cancelled, no_show, completed]
      responses:
        '200':
          description: Success
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/AppointmentList'
```

---

**Document Control**
- Author: Integration Team
- Reviewers: Engineering, Security
- Approval Date: TBD
- Next Review: 60 days post-launch
