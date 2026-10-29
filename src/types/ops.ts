// Operations data: the Outbox, goals and connections (Rust: src-tauri/src/ops.rs).

export type OutboxStatus = 'pending' | 'sending' | 'sent' | 'skipped' | 'failed';

// ~/portfolio/outbox/<id>.json, written by bin/outbox_add.py.
export interface OutboxMessage {
  id: string;
  entity: string;
  account: string; // which mailbox it goes out from
  to: string[];
  cc: string[];
  subject: string;
  body: string;
  in_reply_to: string | null;
  references?: string[];
  thread?: string | null;
  why: string; // why the agent wrote it
  created_by: string;
  created_at: string;
  status: OutboxStatus;
  draft?: { saved: boolean; error: string | null };
  sent_at?: string | null;
  skipped_at?: string | null;
  edited_at?: string | null;
  error?: string | null;
}

export interface OutboxEntry {
  content: string; // sha256 of what is shown; Send is refused if the file changed since
  item: OutboxMessage;
}

export interface OutboxSnapshot {
  items: OutboxEntry[];
  key: string | null; // fingerprint of the send key, once Pulse has made one
  errors: string[];
  read_at: string;
}

// <entity path>/goals.json (schema in ~/portfolio/STATUS_SCHEMA.md).
export interface Goal {
  id: string;
  title: string;
  metric: string;
  target: number | null;
  unit: string;
  by: string | null; // YYYY-MM-DD
  current: number | null;
  source: string;
  owner_note: string;
  proposed?: boolean; // a lead's proposal the owner hasn't confirmed
  start?: string | null;
  baseline?: number | null;
  direction?: 'up' | 'down';
  lead_note?: string;
  at_risk?: boolean;
  updated?: string;
  source_detail?: string;
}

export interface GoalsDoc {
  entity?: string;
  updated?: string | null;
  goals: Goal[];
}

export interface GoalsSnapshot {
  entities: { entity: string; goals: GoalsDoc | null; error: string | null }[];
  read_at: string;
}

export type ConnectionStatus = 'connected' | 'needs-auth' | 'not-set-up';

// ~/portfolio/connections.json, refreshed by bin/connections_check.py.
export interface Connection {
  id: string;
  name: string;
  category: string;
  for: string; // what agents use it for
  entities: string[];
  access: string; // how agents reach it
  mode?: string; // read-only, draft-only, ...
  status: ConnectionStatus;
  status_detail?: string;
  checked_at?: string;
  connect_steps: string[];
  notes?: string;
  sources?: string[];
}

export interface ConnectionsDoc {
  systems: Connection[];
  checked_at?: string;
}
