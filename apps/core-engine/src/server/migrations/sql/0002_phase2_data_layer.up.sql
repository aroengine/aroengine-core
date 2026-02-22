CREATE TABLE IF NOT EXISTS customers (
  id TEXT PRIMARY KEY,
  phone TEXT NOT NULL UNIQUE,
  email TEXT,
  name TEXT,
  no_show_count INTEGER NOT NULL DEFAULT 0,
  reschedule_count INTEGER NOT NULL DEFAULT 0,
  cancel_count INTEGER NOT NULL DEFAULT 0,
  confirmation_rate REAL NOT NULL DEFAULT 0,
  lifetime_value REAL NOT NULL DEFAULT 0,
  payment_status TEXT NOT NULL DEFAULT 'no_history',
  deposits_paid INTEGER NOT NULL DEFAULT 0,
  review_status TEXT NOT NULL DEFAULT 'none',
  last_review_request_date TEXT,
  communication_preference TEXT NOT NULL DEFAULT 'sms',
  risk_score INTEGER NOT NULL DEFAULT 0,
  risk_category TEXT NOT NULL DEFAULT 'low',
  requires_deposit INTEGER NOT NULL DEFAULT 0,
  tags TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_customer_phone ON customers(phone);
CREATE INDEX IF NOT EXISTS idx_customer_risk ON customers(risk_category, risk_score);
CREATE INDEX IF NOT EXISTS idx_customer_updated ON customers(updated_at DESC);

CREATE TABLE IF NOT EXISTS appointments (
  id TEXT PRIMARY KEY,
  external_id TEXT,
  customer_id TEXT NOT NULL,
  date TEXT NOT NULL,
  duration INTEGER NOT NULL,
  service_type TEXT NOT NULL,
  service_cost REAL NOT NULL,
  provider TEXT,
  location TEXT,
  status TEXT NOT NULL DEFAULT 'booked',
  previous_status TEXT NOT NULL,
  confirmation_received INTEGER NOT NULL DEFAULT 0,
  confirmation_date TEXT,
  response_classification TEXT,
  deposit_required INTEGER NOT NULL DEFAULT 0,
  deposit_amount REAL,
  deposit_paid INTEGER NOT NULL DEFAULT 0,
  deposit_payment_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT,
  cancelled_at TEXT,
  notes TEXT,
  FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_appointment_customer ON appointments(customer_id);
CREATE INDEX IF NOT EXISTS idx_appointment_date ON appointments(date);
CREATE INDEX IF NOT EXISTS idx_appointment_status ON appointments(status);
CREATE INDEX IF NOT EXISTS idx_appointment_upcoming ON appointments(date)
  WHERE status IN ('booked', 'confirmed');

CREATE TABLE IF NOT EXISTS reminder_logs (
  id TEXT PRIMARY KEY,
  appointment_id TEXT NOT NULL,
  sent_at TEXT NOT NULL,
  type TEXT NOT NULL,
  channel TEXT NOT NULL,
  message_id TEXT,
  delivered INTEGER NOT NULL DEFAULT 0,
  read INTEGER,
  created_at TEXT NOT NULL,
  FOREIGN KEY (appointment_id) REFERENCES appointments(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_reminder_appointment ON reminder_logs(appointment_id);
CREATE INDEX IF NOT EXISTS idx_reminder_sent ON reminder_logs(sent_at DESC);

CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  timestamp TEXT NOT NULL,
  type TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  actor TEXT NOT NULL,
  actor_id TEXT,
  data TEXT NOT NULL,
  metadata TEXT NOT NULL,
  replay_cursor TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_event_timestamp ON events(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_event_type ON events(type);
CREATE INDEX IF NOT EXISTS idx_event_entity ON events(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_event_actor ON events(actor, actor_id);

CREATE TABLE IF NOT EXISTS workflow_instances (
  id TEXT PRIMARY KEY,
  workflow_name TEXT NOT NULL,
  appointment_id TEXT NOT NULL,
  current_state TEXT NOT NULL,
  state_data TEXT NOT NULL,
  started_at TEXT NOT NULL,
  last_updated_at TEXT NOT NULL,
  completed_at TEXT,
  failed_at TEXT,
  retry_count INTEGER NOT NULL DEFAULT 0,
  max_retries INTEGER NOT NULL DEFAULT 3,
  error TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (appointment_id) REFERENCES appointments(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_workflow_appointment ON workflow_instances(appointment_id);
CREATE INDEX IF NOT EXISTS idx_workflow_state ON workflow_instances(current_state);
CREATE INDEX IF NOT EXISTS idx_workflow_active ON workflow_instances(completed_at, failed_at)
  WHERE completed_at IS NULL AND failed_at IS NULL;

CREATE TABLE IF NOT EXISTS business_config (
  id TEXT PRIMARY KEY,
  business_name TEXT NOT NULL,
  phone TEXT NOT NULL,
  email TEXT NOT NULL,
  address TEXT,
  timezone TEXT NOT NULL,
  business_hours TEXT NOT NULL,
  integrations TEXT NOT NULL,
  rules TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_single_config ON business_config ((1));