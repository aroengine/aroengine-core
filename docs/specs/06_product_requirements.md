# Product Requirements & MVP Specification
**Appointment Revenue Optimizer (ARO)**
Version: 1.0
Date: 2026-02-22

## 1. Executive Summary

ARO is a production-ready autonomous agent system that reduces no-shows for appointment-based businesses. This document defines the MVP scope, success criteria, and go-to-market strategy.

### 1.1 Requirements Layering (Safe Refactor)

- **Core Platform requirements (domain-agnostic):** booking events, reminders, confirmations, no-show recovery, idempotency, retries, rate limits, auth, and audit.
- **Vertical Profile requirements:** profile-specific messaging, compliance, and go-to-market overlays.
- **Current default profile (Phase 1):** `healthcare`.

All existing MVP acceptance criteria remain unchanged and are treated as the `healthcare` profile baseline.

### 1.2 Service Product Model (ADR-0006)

- Product delivery model is `Profile UI + Profile Backend` over a shared independent `Core Engine` service.
- Profile teams can ship UX/backend changes without requiring core-engine release, as long as v1 contracts are respected.
- New profile launches must prove no core business-logic fork and rely on Profile Pack overlays.

## 2. Problem Statement

### 2.1 Customer Pain Points
- **Healthcare profile benchmark:** No-shows cost $3k-$10k/month in lost revenue for small clinics
- Manual reminder systems are inconsistent and time-consuming
- No systematic way to identify high-risk customers
- Review requests are forgotten after appointments
- Rebooking is reactive, not proactive

### 2.2 Current Solutions (Inadequate)
- **Basic SMS reminders**: Static, no intelligence
- **CRM built-in tools**: Not specialized for appointments
- **Reception staff**: Expensive, inconsistent, limited hours
- **Booking platform reminders**: One-size-fits-all, no adaptation

## 3. MVP Scope

### 3.0 Core Platform Scope (Profile-Agnostic)

The MVP feature set below is Core Platform scope and applies to all appointment-based verticals.
Current wording/examples remain aligned to the `healthcare` profile.

### 3.1 What We're Building (MVP = 4 Features)

#### Feature 1: Booking Webhook Listener
**Description**: Automatically import appointments from booking systems

**Acceptance Criteria**:
- ✓ Receive webhook from Calendly/Acuity/Square
- ✓ Create customer record (or link to existing)
- ✓ Create appointment record
- ✓ Trigger confirmation workflow
- ✓ Log all events to audit trail

**Technical Requirements**:
- Webhook endpoint with signature verification
- Idempotent processing (handle duplicate webhooks)
- < 2 second processing time

#### Feature 2: Reminder Sequence (48h + 24h)
**Description**: Send automated reminders at 48h and 24h before appointment

**Acceptance Criteria**:
- ✓ Schedule reminder at 48 hours before appointment
- ✓ Send via customer's preferred channel (SMS/WhatsApp)
- ✓ Wait 2 hours for response
- ✓ If no response, send 24h reminder (more urgent tone)
- ✓ Log all reminder sends and deliveries

**Message Templates**:
```
48h Reminder (Friendly):
"Hi [Name]! This is a reminder about your [Service] appointment on [Date] at [Time]. 
Reply YES to confirm or RESCHEDULE if you need to change it. - [Business Name]"

24h Reminder (Urgent):
"Reminder: Your [Service] appointment is tomorrow at [Time]. Please confirm by replying YES 
or call us at [Phone] to reschedule. - [Business Name]"
```

**Technical Requirements**:
- Time-based trigger system
- Support SMS and WhatsApp
- Handle timezone conversions
- Retry on delivery failure (3 attempts)

#### Feature 3: Confirmation Classification
**Description**: Understand customer responses and update appointment status

**Acceptance Criteria**:
- ✓ Receive inbound SMS/WhatsApp message
- ✓ Classify intent: confirmed / reschedule / cancel / unclear
- ✓ Update appointment status if confirmed
- ✓ Send appropriate follow-up
- ✓ Escalate to admin if unclear or reschedule requested

**Classification Logic**:
- Use LLM with low temperature (0.1) for consistency
- Confidence threshold: 0.7 (escalate if lower)
- Handle common variations: "yes", "yep", "confirmed", "👍", etc.

**Technical Requirements**:
- Inbound webhook from messaging provider
- LLM integration for classification
- < 5 second response time
- Fallback to admin if classification fails

#### Feature 4: Review Request After Appointment
**Description**: Send review request 6 hours after appointment completion

**Acceptance Criteria**:
- ✓ Detect appointment completion (2 hours after scheduled time)
- ✓ Wait 6 hours cooldown period
- ✓ Send review request with Google/Yelp link
- ✓ Track if review submitted
- ✓ Send rebooking offer 24h later

**Message Template**:
```
"Hi [Name], thank you for visiting [Business Name]! We'd love to hear about your 
experience. Please leave us a review: [ReviewLink]. 
As a thank you, enjoy 10% off your next visit!"
```

**Technical Requirements**:
- Time-based trigger (appointment.date + duration + 6h)
- Review link generation
- Track review submission via webhook (if integrated)

### 3.2 What We're NOT Building (MVP)

#### Out of Scope for MVP:
- ❌ AI upsell engine
- ❌ LTV optimization algorithms
- ❌ Multi-branch/multi-location support
- ❌ Multi-language auto-detection
- ❌ Advanced analytics dashboards
- ❌ CRM replacement features
- ❌ Payment automation beyond deposit links
- ❌ Automated rebooking (requires human approval)
- ❌ SMS marketing campaigns
- ❌ Customer segmentation tools

#### Why These Are Out:
**Focus**: We're building a "No-show reducer v1", not an "AI business OS"
**Speed**: 30-day execution window requires ruthless scope control
**Validation**: Need market proof before expanding features

### 3.3 MVP Success Criteria

**Product Success**:
- 30-50% reduction in no-show rate (measured over 60 days)
- >80% customer confirmation rate
- >60% response rate to reminders
- <5% false positive/negative in intent classification

**Business Success**:
- 3 paid pilot customers by end of Week 4
- $897 MRR ($299/customer)
- 2 testimonials with quantified results
- <1 hour average support time per customer per week

**Technical Success**:
- 99.5% uptime for daemon service
- >95% message delivery rate
- >98% webhook processing success
- <2 second average API response time
- Zero data loss incidents

## 4. User Stories

### 4.1 Business Owner Stories

**Story 1: Onboarding**
```
As a healthcare clinic owner (default profile),
I want to install ARO in under 30 minutes,
So that I don't need to hire a developer or IT consultant.

Acceptance:
- CLI installer guides through entire setup
- All API integrations tested during installation
- Test workflow runs successfully
- Dashboard accessible immediately
```

**Story 2: Daily Operation**
```
As a healthcare clinic manager (default profile),
I want ARO to handle appointment confirmations automatically,
So that my staff can focus on patient care instead of phone calls.

Acceptance:
- No manual intervention needed for standard confirmations
- Admin dashboard shows today's appointment statuses
- Alerts for any issues or unclear responses
- Manual override always available
```

**Story 3: High-Risk Detection**
```
As a healthcare clinic owner (default profile),
I want to know which customers are high-risk for no-shows,
So that I can require deposits or call them personally.

Acceptance:
- Risk score visible in customer profile
- Automatic deposit request for risk score >70
- Admin notification when high-risk customer books
- Historical no-show data tracked
```

### 4.2 Customer (End User) Stories

These end-user personas are examples for the `healthcare` default profile baseline in Phase 1.

**Story 1: Appointment Reminder**
```
As a dental patient,
I want to receive a reminder about my appointment,
So that I don't forget and can confirm easily.

Acceptance:
- Receive reminder 48h before via SMS
- Simple reply ("YES") to confirm
- Clear business name and contact info
- Option to reschedule if needed
```

**Story 2: Review Request**
```
As a satisfied patient,
I want an easy way to leave a review,
So that I can support the business without having to search for their profile.

Acceptance:
- Receive review request a few hours after visit
- Direct link to review platform
- Not sent if appointment was cancelled/no-show
```

## 5. Technical Requirements

### 5.1 Functional Requirements

**FR-1: Webhook Processing**
- Support Calendly, Acuity, Square webhooks
- Signature verification required
- Idempotent processing (deduplicate)
- Process within 2 seconds
- Queue for async processing if needed

**FR-2: Message Delivery**
- Support SMS and WhatsApp
- Template-based message generation
- Variable substitution (name, date, time, etc.)
- Delivery confirmation tracking
- Retry on failure (exponential backoff, max 3 attempts)

**FR-3: Response Classification**
- LLM-based intent detection
- Confidence scoring
- Support common variations and typos
- Handle emoji responses
- Escalation path for unclear intents

**FR-4: Time-Based Triggers**
- Schedule triggers relative to appointment time
- Timezone-aware scheduling
- Handle daylight saving time changes
- Cancellation of triggers if appointment cancelled

**FR-5: Admin Dashboard**
- List view of all appointments
- Filter by status, date, customer
- Manual status updates
- View customer risk profile
- Basic metrics (no-show rate, confirmation rate)

### 5.2 Non-Functional Requirements

**NFR-1: Reliability**
- 99.5% uptime target
- Automatic restart on crashes
- Database auto-backup (daily)
- Graceful degradation if external API fails

**NFR-2: Performance**
- Webhook processing: <2s
- Message send: <5s
- Dashboard page load: <1s
- Support 1,000 appointments/month per instance

**NFR-3: Security**
- All API credentials encrypted at rest
- TLS for all external communications
- Webhook signature verification
- Admin dashboard password protection
- Audit log for all critical actions

**NFR-4: Maintainability**
- Structured logging (JSON format)
- Health check endpoints
- Database migrations versioned
- Configuration via files (no hardcoding)
- Error tracking with stack traces

**NFR-5: Data Privacy**
- GDPR-compliant data export
- Customer data deletion on request
- No PHI in messages (HIPAA consideration)
- Local data storage (self-hosted option)

## 6. Pricing Strategy

### 6.1 Phase 1: Early Adopters (First 5 Customers)

**Simple Flat Pricing**:
- $299/month
- No setup fee
- No per-message fees
- All features included
- Unlimited appointments (up to 1,000/month)

**Goal**: Testimonials + usage data

### 6.2 Phase 2: Standard Pricing (After 5 Customers)

**Starter Tier**:
- $399/month
- Up to 300 appointments
- Core reminder features
- Email support

**Growth Tier**:
- $699/month
- Unlimited appointments
- Review automation
- Deposit logic
- Priority support

### 6.3 Phase 3: Value-Based Pricing (After Moat Built)

**Premium Tier**:
- $1,299/month
- All Growth features
- LTV analytics
- Reactivation campaigns
- AI receptionist mode
- Custom workflows

**ROI Justification**:
If clinic has average appointment value of $150 and reduces 10 no-shows/month:
- Revenue saved: $1,500/month
- ARO cost: $699/month
- Net gain: $801/month (115% ROI)

## 7. Go-to-Market Strategy

### 7.1 Target Customer Profile (ICP)

**Primary Target: Dental Clinics**

**Profile Note**: This ICP is the go-to-market baseline for the `healthcare` profile in Phase 1. Core Platform functionality remains domain-agnostic.

**Characteristics**:
- Single location
- 100-300 appointments/month
- $150-300 average appointment value
- 10-20% no-show rate historically
- Currently using Calendly/Acuity/Square
- Pain: Lost revenue from no-shows

**Decision Maker**: Practice owner or office manager
**Budget Authority**: Usually owner
**Buying Process**: 1-2 decision makers, short sales cycle

### 7.2 Outreach Strategy

**Cold Email Template**:
```
Subject: Reducing No-Shows at [Clinic Name]

Hi Dr. [Name],

Quick question: How many appointments did you lose last month due to no-shows?

Most dental clinics lose $3k–$10k/month in missed revenue.

We've built a system that automatically confirms appointments, 
follows up with non-responders, and reduces no-shows by 30–50% 
— without changing your booking system.

Would you be open to a 15-minute call to see if this fits your workflow?

Best,
[Your Name]
```

**Follow-up 1** (3 days later):
```
Dr. [Name],

Just checking in — reducing even 4 missed appointments per week 
usually pays for the system entirely.

Happy to show you a quick demo if you have 10 minutes this week.

Best,
[Your Name]
```

**Follow-up 2** (7 days later):
```
Dr. [Name],

I know no-shows are frustrating, but I don't want to keep bothering you.

If you'd like to see how other clinics are reducing no-shows, 
let me know and I'll send over a case study.

Otherwise, I'll close your file.

Best,
[Your Name]
```

### 7.3 Demo Script (15 minutes)

**Minute 1-3: Problem Discovery**
- "How many no-shows do you typically see per week?"
- "How much revenue does that represent?"
- "What's your current process for confirming appointments?"

**Minute 4-8: Live Demo**
- Show appointment being created
- Show reminder being sent
- Show customer response being classified
- Show risk scoring

**Minute 9-12: Value Proposition**
- Calculate their potential savings
- Show testimonials from similar clinics
- Address objections

**Minute 13-15: Close**
- "Would you like to try this for 30 days?"
- Offer simple onboarding
- Schedule installation call

### 7.4 Launch Channels

**Week 1-2: Direct Outreach**
- 50 cold emails to dental clinics
- 20 LinkedIn outreach messages
- Target: 5 demo calls

**Week 3-4: Referral Engine**
- First customer referral incentive ($100 credit)
- Ask for intros to other clinic owners
- Post in relevant Facebook groups

**Month 2: Content**
- Blog post: "How [Clinic Name] Reduced No-Shows by 43%"
- Reddit post in r/dentistry or r/smallbusiness
- LinkedIn case study

## 8. Success Metrics & KPIs

### 8.1 Product Metrics (Track Weekly)

**No-Show Reduction**:
- Baseline: Customer's historical no-show rate
- Target: 30-50% reduction
- Measurement: (Baseline - Current) / Baseline

**Confirmation Rate**:
- Target: >80%
- Measurement: Confirmed appointments / Total appointments

**Response Rate**:
- Target: >60%
- Measurement: Customers who replied / Reminders sent

**False Classification Rate**:
- Target: <5%
- Measurement: Admin overrides / Total classifications

### 8.2 Business Metrics (Track Monthly)

**MRR (Monthly Recurring Revenue)**:
- Month 1: $897 (3 customers × $299)
- Month 2: $1,794 (6 customers)
- Month 3: $2,691 (9 customers)

**Customer Acquisition Cost (CAC)**:
- Target: <$500
- Measurement: Total sales/marketing spend / New customers

**Churn Rate**:
- Target: <5% monthly
- Measurement: Customers churned / Total customers

**Customer Lifetime Value (LTV)**:
- Target: >$5,000
- Estimate: $699/month × 18 months average retention

### 8.3 Technical Metrics (Monitor Daily)

**System Uptime**:
- Target: 99.5%
- Alert if <99%

**Message Delivery Rate**:
- Target: >95%
- Alert if <90%

**Webhook Processing Success**:
- Target: >98%
- Alert on failures

**Average Response Time**:
- Target: <2s for webhooks
- Alert if >5s

## 9. Risk Assessment

### 9.1 Technical Risks

**Risk: External API Downtime**
- Probability: Medium
- Impact: High
- Mitigation: Retry logic, fallback queuing, admin notifications

**Risk: Message Delivery Failures**
- Probability: Low
- Impact: High
- Mitigation: Multiple retry attempts, delivery status tracking, alerts

**Risk: Intent Classification Errors**
- Probability: Medium
- Impact: Medium
- Mitigation: Confidence thresholds, human-in-loop for unclear cases

### 9.2 Business Risks

**Risk: Slow Customer Adoption**
- Probability: Medium
- Impact: High
- Mitigation: Aggressive pricing ($299), strong testimonials, 30-day money-back

**Risk: Competition from Booking Platforms**
- Probability: Medium
- Impact: High
- Mitigation: Better intelligence, behavioral tracking, faster innovation

**Risk: Regulatory Compliance Issues**
- Probability: Low
- Impact: Very High
- Mitigation: TCPA compliance (consent tracking), HIPAA awareness, legal review

### 9.3 Operational Risks

**Risk: Support Burden**
- Probability: High
- Impact: Medium
- Mitigation: Excellent documentation, self-service diagnostics, simple architecture

**Risk: Installation Difficulty**
- Probability: Medium
- Impact: High
- Mitigation: Automated installer, setup wizard, white-glove onboarding

## 10. Development Roadmap

### 10.1 30-Day Execution Plan

**Week 1: Core Infrastructure**
- Day 1-2: Project setup, database schema
- Day 3-4: Webhook receiver + booking integration
- Day 5-7: Messaging integration + basic sending

**Milestone**: Can receive appointment and send message

**Week 2: Workflow Engine**
- Day 8-10: State machine implementation
- Day 11-12: Time-triggered reminders
- Day 13-14: Response classification (LLM)

**Milestone**: End-to-end reminder flow working

**Week 3: Risk & Review**
- Day 15-16: Risk scoring logic
- Day 17-18: Review request automation
- Day 19-21: Admin dashboard (basic)

**Milestone**: Full MVP functional

**Week 4: Polish & Launch**
- Day 22-23: Installation wizard
- Day 24-25: Testing + bug fixes
- Day 26-28: Pilot customer onboarding
- Day 29-30: Documentation + outreach

**Milestone**: 3 paid customers live

### 10.2 Post-MVP Iterations (Month 2-3)

**Month 2 Focus: Stability**
- Error handling improvements
- Admin dashboard enhancements
- Message template optimization
- Customer feedback incorporation

**Month 3 Focus: Growth Features**
- Deposit automation (high-risk customers)
- Multi-platform support (more booking systems)
- Advanced risk scoring
- Rebooking automation

## 11. Competitive Analysis

### 11.1 Competitive Landscape

**Category 1: Basic SMS Reminder Tools**
- Examples: SimpleTexting, EZ Texting
- Price: $20-50/month
- Weakness: No intelligence, no follow-up, static

**Category 2: Booking Platform Built-in Reminders**
- Examples: Calendly, Acuity
- Price: Included
- Weakness: One-size-fits-all, no adaptation, no risk scoring

**Category 3: Full CRM Solutions**
- Examples: HubSpot, Salesforce
- Price: $500-2000/month
- Weakness: Complex, generic, expensive, long setup

**Category 4: Human Receptionists**
- Examples: Virtual assistants, staff
- Price: $2000-4000/month
- Weakness: Expensive, limited hours, inconsistent

### 11.2 ARO's Differentiation

**We Win Because**:
- **Adaptive**: Track behavior, escalate intelligently
- **Specialized**: Built for appointment businesses
- **Integrated**: Works with existing tools
- **Affordable**: $299-699 vs. $2000+ staff cost
- **Automated**: 24/7 operation

**Why Not Just Use Calendly Reminders?**
- No behavioral tracking
- No risk scoring
- No deposit logic
- No review automation
- No follow-up intelligence

## 12. Customer Support Strategy

### 12.1 Support Channels

**Email Support** (All tiers):
- Response time: <24 hours
- Email: support@example.com

**Documentation** (Self-service):
- Installation guide
- Troubleshooting FAQ
- Video tutorials
- Configuration examples

**Priority Support** (Growth tier+):
- Response time: <4 hours
- Dedicated Slack channel (optional)
- Phone support available

### 12.2 Common Support Scenarios

**Scenario 1: Installation Issues**
- Diagnostic command: `aro diagnose`
- Check logs: `aro logs --tail 100`
- Verify API connections: `aro test:integrations`

**Scenario 2: Messages Not Sending**
- Check Twilio credentials
- Verify phone numbers (E.164 format)
- Test connection: `aro test:messaging`

**Scenario 3: Webhooks Not Received**
- Verify webhook URL configured in booking platform
- Check firewall/port accessibility
- Review webhook logs

## 13. Legal & Compliance

### 13.1 Required Compliance

**TCPA (Telephone Consumer Protection Act)**:
- Obtain prior express consent for SMS
- Include opt-out mechanism
- Honor opt-out requests within 24h
- Log all consent records

**GDPR (if serving EU customers)**:
- Right to data export
- Right to deletion
- Consent for data processing
- Data processing agreements

**HIPAA (healthcare profile overlay)**:
- No PHI in SMS messages
- Encrypted storage
- Access controls
- Business Associate Agreement (BAA) available

### 13.2 Terms of Service Key Points

**Customer Responsibilities**:
- Obtain SMS consent from end users
- Maintain accurate appointment data
- Comply with local regulations
- Not use for spam/marketing without consent

**ARO Responsibilities**:
- Maintain system availability
- Protect customer data
- Process messages as configured
- Provide support

**Limitations**:
- No guarantee of no-show elimination
- Not liable for message delivery failures
- Not liable for third-party API outages

---

**Document Control**
- Author: Product Team
- Reviewers: Engineering, Legal, Sales
- Approval Date: TBD
- Next Review: 30 days post-launch
