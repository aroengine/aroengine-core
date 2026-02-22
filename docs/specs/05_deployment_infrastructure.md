# Deployment & Infrastructure Specification
**Appointment Revenue Optimizer (ARO)**
Version: 1.0
Date: 2026-02-22

## 1. Overview

This document specifies deployment strategies, infrastructure requirements, installation procedures, and operational guidelines for the ARO system.

### 1.1 Core and Profile Deployment Model

- Deployment, observability, backup, and recovery procedures in this document are **Core Platform** operations.
- The current default runtime profile is `healthcare` for Phase 1.
- Future vertical profiles (salon, legal consults, coaching, etc.) should reuse the same operational controls and supply profile-specific configuration overlays.

### 1.2 Runtime Topology Contract (ADR-0006)

- Deploy `core-engine` as an independent service with horizontal replicas behind a load balancer.
- Deploy `profile-backend` and `profile-ui` per profile, independently versioned and releasable.
- Profile UIs communicate only with their profile backend; only profile backend communicates with core-engine.
- Core-engine must remain stateless; all durable state lives in shared persistence layers.

## 2. Deployment Architecture

### 2.0 Environment Topology (MVP)

Required environments:
- `local`: developer workstation
- `staging`: production-like validation (required before production promotion)
- `production`: customer-facing runtime

**Staging Requirements**:
- Same Node.js major version and database engine as production
- Isolated API credentials (provider sandbox/test keys only)
- Full migration + rollback rehearsal before release
- Seeded synthetic data (no real customer PII)
- Smoke tests and integration tests must pass before GO/NO-GO

### 2.1 Deployment Options

#### Option A: Self-Hosted (MVP Focus)
**Description**: Customer installs and runs ARO on their own hardware/VM

**Target Environment**:
- Mac Mini (Apple Silicon or Intel)
- Linux server (Ubuntu 22.04+, Debian 11+)
- VPS (DigitalOcean, Linode, AWS EC2)

**Advantages**:
- Complete data control
- No recurring cloud costs
- HIPAA-friendly (data stays local)
- Differentiation from SaaS competitors

**Disadvantages**:
- Customer manages hardware
- Requires basic technical knowledge
- Support burden for varied environments

#### Option B: Managed Cloud (Phase 2)
**Description**: ARO team provisions and manages infrastructure per customer

**Target Environment**:
- AWS EC2 or Lightsail
- Isolated VPC per customer
- Managed databases (RDS)

**Advantages**:
- Easier onboarding
- Centralized monitoring
- Predictable environment

**Disadvantages**:
- Higher operational costs
- Multi-tenant infrastructure complexity

### 2.2 System Requirements

#### Minimum Requirements
- **CPU**: 2 cores (2.0 GHz)
- **RAM**: 4 GB
- **Storage**: 20 GB SSD
- **Network**: Broadband internet (5 Mbps upload)
- **OS**: 
  - macOS 12+ (Monterey or newer)
  - Ubuntu 20.04+ / Debian 11+
  - CentOS 8+ / RHEL 8+

#### Recommended Requirements
- **CPU**: 4 cores (2.5 GHz)
- **RAM**: 8 GB
- **Storage**: 40 GB SSD
- **Network**: Fiber/broadband (20+ Mbps)

#### Software Dependencies
- **Node.js**: v18 LTS or v20 LTS
- **Database**: SQLite 3.40+ (bundled) or PostgreSQL 14+
- **Process Manager**: PM2 or systemd
- **OpenClaw**: `>=1.0.0 <2.0.0` (pinned per release)

## 3. Installation Process

### 3.1 Installer Architecture

```
┌─────────────────────────┐
│   ARO Installer CLI     │
│   (Interactive Wizard)  │
└────────┬────────────────┘
         │
    ┌────▼─────────────────┐
    │ System Check         │
    │ - OS detection       │
    │ - Node.js version    │
    │ - Port availability  │
    └────┬─────────────────┘
         │
    ┌────▼─────────────────┐
    │ OpenClaw Setup       │
    │ - Download runtime   │
    │ - Configure models   │
    └────┬─────────────────┘
         │
    ┌────▼─────────────────┐
    │ ARO Configuration    │
    │ - Business details   │
    │ - API credentials    │
    │ - Skill packs        │
    └────┬─────────────────┘
         │
    ┌────▼─────────────────┐
    │ Database Initialization│
    │ - Schema migration   │
    │ - Seed data          │
    └────┬─────────────────┘
         │
    ┌────▼─────────────────┐
    │ Service Installation │
    │ - Daemon setup       │
    │ - Auto-start config  │
    └────┬─────────────────┘
         │
    ┌────▼─────────────────┐
    │ Verification         │
    │ - Health checks      │
    │ - Test workflow      │
    └──────────────────────┘
```

### 3.2 CLI Installer

**Installation Command**:
```bash
curl -fsSL https://install.example.com/install.sh | bash
# or
npm install -g @aro/installer
aro-install
```

**Interactive Setup Flow**:

```bash
$ aro-install

╔═══════════════════════════════════════════════════╗
║  Appointment Revenue Optimizer (ARO) Installer    ║
║  Version 1.0.0                                     ║
╚═══════════════════════════════════════════════════╝

✓ System check passed
  - OS: macOS 14.0 (Sonoma)
  - Node.js: v20.10.0 ✓
  - Available disk: 45 GB ✓

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Step 1/6: Business Information
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

? Business Name: Smile Dental Clinic
? Business Phone: +1 (555) 123-4567
? Business Email: admin@smiledental.com
? Timezone: America/New_York

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Step 2/6: Booking System Integration
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

? Select booking platform:
  ❯ Calendly
    Acuity Scheduling
    Square Appointments
    Custom Webhook

? Calendly API Key: ********************************
? Test connection... ✓ Connected successfully

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Step 3/6: Messaging Service
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

? Select messaging provider:
  ❯ Twilio (SMS)
    WhatsApp via Twilio
    Both

? Twilio Account SID: ********************************
? Twilio Auth Token: ********************************
? Your Phone Number: +1 (555) 987-6543
? Test connection... ✓ Connected successfully

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Step 4/6: Payment Processing (Optional)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

? Enable deposit collection? Yes
? Select payment provider:
  ❯ Stripe
    Skip for now

? Stripe Secret Key: ********************************
? Stripe Publishable Key: ********************************
? Test connection... ✓ Connected successfully

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Step 5/6: Business Rules
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

? Default deposit amount: $50
? Risk threshold for deposits (0-100): 70
? Reminder timing: [48h, 24h]
? Enable review requests? Yes

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Step 6/6: Installation
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

✓ Installing OpenClaw runtime...
✓ Installing ARO skill packs...
✓ Initializing database...
✓ Running migrations...
✓ Configuring daemon service...
✓ Starting ARO service...
✓ Running health checks...

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

🎉 Installation Complete!

ARO is now running at:
  Admin Dashboard: http://localhost:3000
  API Endpoint: http://localhost:3000/api/v1

Service Status:
  ✓ ARO Service: Running
  ✓ Database: Connected
  ✓ OpenClaw: Ready

Next Steps:
  1. Access dashboard: http://localhost:3000
  2. Default login: admin / [auto-generated password shown]
  3. Import existing customers (optional)
  4. Test workflow with sample appointment

Documentation: https://docs.example.com
Support: support@example.com

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

### 3.3 Configuration Files

**ARO Configuration** (`~/.aro/config.json`):
```json
{
  "version": "1.0.0",
  "business": {
    "name": "Smile Dental Clinic",
    "phone": "+15551234567",
    "email": "admin@smiledental.com",
    "timezone": "America/New_York"
  },
  "integrations": {
    "booking": {
      "provider": "calendly",
      "apiKey": "encrypted:...",
      "webhookUrl": "https://aro.local/webhooks/calendly"
    },
    "messaging": {
      "provider": "twilio",
      "accountSid": "encrypted:...",
      "authToken": "encrypted:...",
      "phoneNumber": "+15559876543"
    },
    "payment": {
      "provider": "stripe",
      "secretKey": "encrypted:...",
      "publishableKey": "pk_test_..."
    }
  },
  "rules": {
    "depositThreshold": 70,
    "depositAmount": 50.00,
    "reminderTiming": ["48h", "24h"],
    "reviewRequestEnabled": true,
    "reviewRequestDelay": 6
  },
  "database": {
    "type": "sqlite",
    "path": "~/.aro/data/aro.db"
  },
  "server": {
    "port": 3000,
    "host": "0.0.0.0"
  }
}
```

**OpenClaw Configuration** (`~/.aro/openclaw.yml`):
```yaml
openclaw:
  version: "1.0"
  model:
    provider: "openai"
    model: "gpt-4"
    apiKey: "${OPENAI_API_KEY}"
  
  skills_path: "~/.aro/skills"
  workflows_path: "~/.aro/workflows"
  
  memory:
    type: "database"
    connection: "~/.aro/data/aro.db"
  
  logging:
    level: "info"
    path: "~/.aro/logs"
```

### 3.4 Service Management

#### systemd (Linux)

**Service File** (`/etc/systemd/system/aro.service`):
```ini
[Unit]
Description=Appointment Revenue Optimizer
After=network.target

[Service]
Type=simple
User=aro
WorkingDirectory=/opt/aro
ExecStart=/usr/bin/node /opt/aro/bin/aro start
Restart=always
RestartSec=10
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
```

**Commands**:
```bash
# Start service
sudo systemctl start aro

# Enable auto-start
sudo systemctl enable aro

# Check status
sudo systemctl status aro

# View logs
sudo journalctl -u aro -f
```

#### launchd (macOS)

**Launch Agent** (`~/Library/LaunchAgents/com.aro.agent.plist`):
```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.aro.agent</string>
    <key>ProgramArguments</key>
    <array>
        <string>/usr/local/bin/node</string>
        <string>/opt/aro/bin/aro</string>
        <string>start</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>/tmp/aro.log</string>
    <key>StandardErrorPath</key>
    <string>/tmp/aro.error.log</string>
</dict>
</plist>
```

**Commands**:
```bash
# Load service
launchctl load ~/Library/LaunchAgents/com.aro.agent.plist

# Start service
launchctl start com.aro.agent

# Stop service
launchctl stop com.aro.agent

# View logs
tail -f /tmp/aro.log
```

## 4. Database Management

### 4.1 Initial Setup

```bash
# Create database
aro db:init

# Run migrations
aro db:migrate

# Seed initial data
aro db:seed

# Backup database
aro db:backup --output ~/backups/aro-backup-2026-02-22.sql
```

### 4.2 Migration Strategy

**Migration Files** (`~/.aro/migrations/`):
```
001_initial_schema.sql
002_add_reminder_logs.sql
003_add_workflow_instances.sql
...
```

**Migration Tool**:
```bash
# Create new migration
aro db:migration:create add_customer_tags

# Apply pending migrations
aro db:migrate

# Rollback last migration
aro db:migrate:rollback

# Check migration status
aro db:migrate:status
```

### 4.3 Backup & Restore

**Automated Backups**:
```bash
# Configure automatic daily backups
aro config:set backup.enabled=true
aro config:set backup.schedule="0 2 * * *"  # 2 AM daily
aro config:set backup.retention=30  # Keep 30 days
```

**Manual Backup**:
```bash
# SQLite
aro db:backup --output ~/backups/aro-$(date +%Y%m%d).db

# PostgreSQL
pg_dump aro_production > ~/backups/aro-$(date +%Y%m%d).sql
```

**Restore**:
```bash
# SQLite
aro db:restore --input ~/backups/aro-20260222.db

# PostgreSQL
psql aro_production < ~/backups/aro-20260222.sql
```

## 5. Monitoring & Logging

### 5.1 Health Checks

**Health Check Endpoint**:
```http
GET /api/v1/health

Response:
{
  "status": "healthy",
  "timestamp": "2026-02-22T10:00:00Z",
  "services": {
    "database": "up",
    "openclaw": "up",
    "booking_api": "up",
    "messaging_api": "up",
    "payment_api": "up"
  },
  "metrics": {
    "uptime": 86400,
    "memory_usage": 0.45,
    "cpu_usage": 0.12
  }
}
```

**Monitoring Script**:
```bash
#!/bin/bash
# ~/.aro/scripts/health-check.sh

while true; do
  response=$(curl -s http://localhost:3000/api/v1/health)
  status=$(echo $response | jq -r '.status')
  
  if [ "$status" != "healthy" ]; then
    echo "ARO health check failed at $(date)" | mail -s "ARO Alert" admin@smiledental.com
  fi
  
  sleep 300  # Check every 5 minutes
done
```

### 5.2 Logging Configuration

**Log Levels**:
- `error`: Critical errors requiring immediate attention
- `warn`: Warning conditions
- `info`: Informational messages (default)
- `debug`: Detailed debugging information

**Log Files**:
```
~/.aro/logs/
  ├── aro.log              # Main application log
  ├── aro-error.log        # Error log only
  ├── openclaw.log         # OpenClaw runtime log
  ├── workflows.log        # Workflow execution log
  └── api.log              # API request/response log
```

**Log Rotation**:
```javascript
// Winston configuration
const winston = require('winston');
require('winston-daily-rotate-file');

const transport = new winston.transports.DailyRotateFile({
  filename: '~/.aro/logs/aro-%DATE%.log',
  datePattern: 'YYYY-MM-DD',
  maxSize: '20m',
  maxFiles: '30d'
});
```

### 5.3 Metrics Collection

**Key Metrics**:
```typescript
interface SystemMetrics {
  // Performance
  uptime: number;
  cpu_usage: number;
  memory_usage: number;
  disk_usage: number;
  
  // Application
  appointments_processed: number;
  workflows_executed: number;
  messages_sent: number;
  api_requests: number;
  
  // Business
  no_show_rate: number;
  confirmation_rate: number;
  revenue_saved: number;
}
```

**Metrics Export**:
```bash
# Export metrics to CSV
aro metrics:export --format csv --period month --output ~/reports/

# Export to JSON
aro metrics:export --format json --period week
```

## 6. Updates & Maintenance

### 6.1 Update Process

**Check for Updates**:
```bash
aro update:check

Response:
New version available: 1.1.0
Current version: 1.0.0

Release notes:
- Added WhatsApp support
- Improved risk scoring algorithm
- Bug fixes

Run 'aro update' to install.
```

**Install Update**:
```bash
# Automatic update
aro update

# Manual update with backup
aro db:backup
aro update --with-backup
```

**Update Strategy**:
1. Automatic backup before update
2. Download new version
3. Run database migrations
4. Restart service
5. Verify health checks
6. Rollback if health checks fail

### 6.2 Rollback Procedure

```bash
# List available versions
aro versions:list

# Rollback to previous version
aro rollback --version 1.0.0

# Restore database backup
aro db:restore --input ~/backups/aro-pre-update.db
```

## 7. Security Hardening

### 7.1 Firewall Configuration

```bash
# Allow only necessary ports
sudo ufw allow 22/tcp    # SSH
sudo ufw allow 80/tcp    # HTTP (optional, for public webhook)
sudo ufw allow 443/tcp   # HTTPS (optional)
sudo ufw enable

# Restrict admin dashboard to local only
# Dashboard runs on localhost:3000 by default
```

### 7.2 SSL/TLS Configuration

**Using Let's Encrypt (Optional)**:
```bash
# Install certbot
sudo apt install certbot

# Generate certificate
sudo certbot certonly --standalone -d aro.yourdomain.com

# Configure ARO to use certificate
aro config:set server.ssl.enabled=true
aro config:set server.ssl.cert=/etc/letsencrypt/live/aro.yourdomain.com/fullchain.pem
aro config:set server.ssl.key=/etc/letsencrypt/live/aro.yourdomain.com/privkey.pem
```

### 7.3 Environment Variables

**Secure Credential Storage**:
```bash
# Use environment variables for sensitive data
export OPENAI_API_KEY="sk-..."
export TWILIO_AUTH_TOKEN="..."
export STRIPE_SECRET_KEY="sk_test_..."

# Or use encrypted credential store
aro secrets:set OPENAI_API_KEY
Enter value: ********
Secret stored securely.
```

## 8. Troubleshooting & Operational Readiness

### 8.1 Diagnostic Tools

**Comprehensive Diagnostics**:
```bash
$ aro diagnose --verbose

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
ARO System Diagnostics
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

System Information:
  ✓ OS: macOS 14.0 (Darwin)
  ✓ Node.js: v20.10.0
  ✓ ARO Version: 1.0.0
  ✓ Uptime: 3 days, 14 hours
  ○ CPU Usage: 12% (normal)
  ○ Memory Usage: 45% (2.1GB / 4GB)
  ○ Disk Space: 25GB free

Database:
  ✓ Connection: OK
  ✓ Tables: 12/12 present
  ✓ Last backup: 2h ago
  ○ Database size: 125 MB
  ○ Active connections: 5

External Integrations:
  ✓ Calendly API: Connected (response: 245ms)
  ✓ Twilio API: Connected (response: 180ms)
  ✗ Stripe API: Circuit breaker OPEN (last failed: 5m ago)
  
Service Status:
  ✓ OpenClaw Runtime: Running
  ✓ Workflow Engine: Running
  ✓ Web Server: Running (port 3000)
  ✓ Background Jobs: Running (3 workers)

Recent Errors (last hour):
  ⚠ 5 failed message sends (Twilio rate limit)
  ⚠ 1 webhook processing timeout
  
Circuit Breakers:
  ✓ messaging: CLOSED
  ✗ payment: OPEN (will retry in 25s)
  ✓ booking: CLOSED

Recommendations:
  ⚠ Stripe API failing - check credentials
  ℹ Run 'aro logs --filter stripe' for details
  ℹ Consider increasing memory allocation

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

### 8.2 Common Issues & Solutions

**Issue 1: Service Won't Start**
```bash
# Step 1: Check logs
aro logs --tail 100 --level error

# Step 2: Check port availability
lsof -i :3000
# If busy: kill -9 <PID> or change port

# Step 3: Check database connection
aro db:ping
# If failed: check ~/.aro/data/aro.db exists

# Step 4: Verify configuration
aro config:validate
# If invalid: aro config:repair

# Step 5: Check file permissions
ls -la ~/.aro/
# Fix: chmod 755 ~/.aro && chown -R $USER ~/.aro

# Step 6: Clean restart
aro stop && aro clean-cache && aro start

# Nuclear option: Reinstall (preserves data)
aro reinstall --keep-data
```

**Issue 2: Webhooks Not Receiving**
```bash
# Step 1: Test webhook endpoint locally
curl -X POST http://localhost:3000/webhooks/test \
  -H "Content-Type: application/json" \
  -d '{"test": true}'

# Step 2: Check if port is accessible externally (if needed)
curl https://your-public-ip/webhooks/calendly

# Step 3: Check firewall
sudo ufw status
# Allow if needed: sudo ufw allow 80/tcp

# Step 4: Verify webhook URL in booking platform
aro config:get integrations.booking.webhookUrl

# Step 5: Check webhook logs
aro logs --filter webhooks --tail 50

# Step 6: Test webhook signature verification
aro test:webhook --source calendly --simulate

# Common fix: URL mismatch
aro config:set integrations.booking.webhookUrl="https://correct-url.com/webhooks/calendly"
```

**Issue 3: Messages Not Sending**
```bash
# Step 1: Check circuit breaker state
aro status:circuit-breakers
# If OPEN: wait for timeout or reset manually
aro circuit-breaker:reset --service messaging

# Step 2: Test messaging connection
aro test:messaging --to +15551234567
# Success: "Test message sent successfully"

# Step 3: Check API credentials
aro config:get integrations.messaging
# Verify: Account SID and Auth Token

# Step 4: Check rate limits
aro status:rate-limits
# If exceeded: wait or increase limits

# Step 5: View messaging logs
aro logs --filter messaging --tail 100

# Step 6: Verify phone number format
# Must be E.164 format: +15551234567 (not +1 555-123-4567)

# Common fixes:
# Fix 1: Invalid credentials
aro config:set integrations.messaging.authToken="new_token"

# Fix 2: Wrong phone number
aro config:set integrations.messaging.phoneNumber="+15559876543"

# Fix 3: Twilio account suspended
# Contact Twilio support, verify account standing
```

**Issue 4: High Memory Usage**
```bash
# Step 1: Check memory stats
aro stats:memory

# Step 2: Check for memory leaks
aro diagnose:memory --watch

# Step 3: Clear caches
aro clean-cache

# Step 4: Restart with fresh state
aro restart --fresh

# Step 5: Increase memory allocation (if needed)
aro config:set system.memory_limit=2048  # MB

# Step 6: Check for stuck workflows
aro workflows:list --status stuck
aro workflows:cancel <workflow-id>
```

**Issue 5: Appointments Not Syncing**
```bash
# Step 1: Check booking API connection
aro test:booking-api

# Step 2: Force manual sync
aro sync:appointments --from "2026-02-01" --to "2026-03-01"

# Step 3: Check last sync time
aro sync:status

# Step 4: Verify API credentials
aro config:get integrations.booking.apiKey

# Step 5: Check for API rate limiting
aro logs --filter booking --grep "rate limit"

# Fix: Re-authorize booking platform
aro integrations:reauth --platform calendly
```

### 8.3 Advanced Diagnostic Commands

```bash
# System health snapshot
aro health:snapshot --output ~/aro-health-$(date +%Y%m%d).json

# Test all integrations
aro test:integrations --verbose

# Verify configuration
aro config:validate --strict

# Database health check
aro db:health --detailed

# Check workflow execution times
aro workflows:analyze --slowest 10

# View circuit breaker history
aro circuit-breakers:history --hours 24

# Rate limit status
aro rate-limits:status --all

# Network connectivity test
aro test:network --endpoints all

# OpenClaw runtime diagnostics
aro openclaw:diagnose
```

### 8.4 Performance Troubleshooting

**Slow Webhook Processing**:
```bash
# Step 1: Check webhook processing times
aro metrics:webhooks --avg-time --last 24h

# Step 2: Identify slow endpoints
aro metrics:webhooks --slowest 10

# Step 3: Check database query performance
aro db:slow-queries --threshold 1000  # ms

# Step 4: Enable query profiling
aro config:set database.profiling=true
aro db:profile --watch

# Step 5: Optimize database
aro db:optimize
aro db:reindex

# Step 6: Increase worker processes
aro config:set workers.webhook=5
aro restart
```

**Slow Message Delivery**:
```bash
# Step 1: Check Twilio API response times
aro metrics:messaging --response-times

# Step 2: Check rate limiter queue depth
aro rate-limits:queue-depth

# Step 3: Increase concurrent workers
aro config:set workers.messaging=3

# Step 4: Check network latency
aro test:network --endpoint twilio

# Step 5: Enable message queuing
aro config:set messaging.queue_enabled=true
```

### 8.5 Monitoring & Alerting

**Key Metrics to Monitor**:

```typescript
interface OperationalMetrics {
  // System health
  uptime_percentage: number;           // Target: >99.5%
  cpu_usage_avg: number;               // Alert: >80%
  memory_usage_avg: number;            // Alert: >85%
  disk_usage_percentage: number;       // Alert: >90%
  
  // Application performance
  webhook_processing_time_p95: number; // Alert: >2000ms
  message_send_time_p95: number;       // Alert: >5000ms
  api_response_time_p95: number;       // Alert: >1000ms
  
  // Business metrics
  message_delivery_rate: number;       // Alert: <90%
  webhook_success_rate: number;        // Alert: <95%
  workflow_completion_rate: number;    // Alert: <95%
  
  // Error rates
  error_rate_per_hour: number;         // Alert: >10
  circuit_breaker_trips_per_day: number; // Alert: >5
  failed_messages_per_hour: number;    // Alert: >5
}
```

**Alert Configuration**:
```bash
# Configure email alerts
aro alerts:config --email admin@example.com

# Set alert thresholds
aro alerts:set cpu_usage --threshold 80 --severity warning
aro alerts:set memory_usage --threshold 85 --severity critical
aro alerts:set message_delivery_rate --threshold 90 --severity critical

# Enable SMS alerts for critical issues
aro alerts:set --sms +15551234567 --severity critical

# Test alerting
aro alerts:test --type email
```

### 8.6 Log Analysis

**Search Logs**:
```bash
# Find errors in last hour
aro logs --level error --since 1h

# Search for specific customer
aro logs --grep "+15551234567" --tail 100

# Find all circuit breaker events
aro logs --grep "circuit.*breaker" --since 24h

# Export logs for support
aro logs --since 7d --output ~/aro-logs-week.log

# Real-time log streaming with filters
aro logs --follow --filter "error|warning"

# Parse JSON logs
aro logs --format json --since 1h | jq '.[] | select(.level=="error")'
```

**Common Log Patterns**:
```bash
# Pattern 1: Twilio rate limit
"WARN: Rate limit exceeded for messaging API. Retry in 60s"
# Action: Wait or increase Twilio account limits

# Pattern 2: Circuit breaker opened
"ERROR: Circuit breaker opened for stripe_api after 5 failures"
# Action: Check Stripe credentials and service status

# Pattern 3: Webhook timeout
"WARN: Webhook processing timeout for appointment apt_123"
# Action: Check database performance, consider increasing timeout

# Pattern 4: Classification low confidence
"WARN: Intent classification confidence 0.45 < 0.7 for message: 'maybe'"
# Action: Review unclear messages, improve prompts
```

### 8.7 Recovery Procedures

**Scenario: Complete System Failure**

```bash
# 1. Verify system state
aro status --all

# 2. Check if process is running
ps aux | grep aro

# 3. Try graceful restart
aro restart

# 4. If restart fails, kill and restart
pkill -9 aro
aro start --force

# 5. If still failing, check logs
aro logs --tail 500 --level error

# 6. Restore from backup if needed
aro db:restore --input ~/backups/aro-latest.db

# 7. Verify restoration
aro db:verify
aro test:integrations

# 8. Resume operations
aro start
aro health:check
```

**Scenario: Database Corruption**

```bash
# 1. Stop ARO service
aro stop

# 2. Backup current database (even if corrupted)
cp ~/.aro/data/aro.db ~/.aro/data/aro-corrupted-$(date +%Y%m%d).db

# 3. Check database integrity
sqlite3 ~/.aro/data/aro.db "PRAGMA integrity_check;"

# 4. If corrupted, restore from last good backup
aro db:restore --input ~/backups/aro-20260221.db

# 5. Verify restoration
aro db:verify

# 6. Restart service
aro start

# 7. Re-sync appointments since backup
aro sync:appointments --since "2026-02-21"
```

**Scenario: External API Completely Down**

```bash
# 1. Check circuit breaker state
aro circuit-breakers:status

# 2. If messaging API down, queue messages
aro config:set messaging.fallback_mode=queue

# 3. Monitor queue depth
aro queue:status

# 4. When API recovers, process queue
aro circuit-breaker:reset --service messaging
aro queue:process --service messaging

# 5. Verify deliveries
aro queue:status
aro logs --filter messaging --since 1h
```

### 8.8 Support Escalation Checklist

**Before Contacting Support**:

1. ✓ Run comprehensive diagnostics: `aro diagnose --verbose`
2. ✓ Collect recent logs: `aro logs --since 24h --output ~/aro-logs.txt`
3. ✓ Export configuration (sensitive data removed): `aro config:export --safe ~/aro-config.json`
4. ✓ Note exact error messages and timestamps
5. ✓ Document steps to reproduce the issue
6. ✓ Check status page: https://status.example.com
7. ✓ Review recent changes (config, updates)

**Information to Provide**:
- ARO version: `aro --version`
- Operating system: `uname -a`
- Node.js version: `node --version`
- Last known working time
- Recent changes or updates
- Error logs
- Diagnostic output

## 9. Scaling Considerations

### 9.1 Single Instance Limits
- **Appointments**: Up to 1,000/month
- **Customers**: Up to 5,000
- **Messages**: Up to 10,000/month
- **Concurrent webhooks**: 10

### 9.2 Horizontal Scaling (Future)
- Load balancer in front of multiple ARO instances
- Shared PostgreSQL database
- Redis for distributed caching
- Message queue for webhook processing

### 9.3 Database Optimization
```bash
# Optimize database
aro db:optimize

# Rebuild indexes
aro db:reindex

# Analyze query performance
aro db:analyze
```

## 10. Disaster Recovery

### 10.1 Backup Strategy
- **Daily**: Automated database backups (2 AM)
- **Weekly**: Full system backup
- **Before updates**: Automatic backup
- **Retention**: 30 days local, 90 days off-site

**Retention Boundary Clarification**:
- Backup retention applies to operational backups only.
- Compliance audit logs follow security policy retention (7 years) and must not be shortened by backup pruning.

### 10.2 Recovery Procedure

**Scenario: Complete system failure**

1. Install ARO on new hardware
```bash
curl -fsSL https://install.example.com/install.sh | bash
```

2. Restore configuration
```bash
cp ~/backups/config.json ~/.aro/config.json
```

3. Restore database
```bash
aro db:restore --input ~/backups/aro-latest.db
```

4. Verify and start
```bash
aro diagnose
aro start
```

**Recovery Time Objective (RTO)**: < 4 hours
**Recovery Point Objective (RPO)**: < 24 hours

---

**Document Control**
- Author: DevOps Team
- Reviewers: Engineering, Support
- Approval Date: TBD
- Next Review: 60 days post-launch
