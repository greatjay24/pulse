// Operations data: the Outbox, goals and connections (Rust: src-tauri/src/ops.rs).

export type OutboxStatus = 'pending' | 'sending' | 'sent' | 'approved' | 'published' | 'skipped' | 'failed';

export type OutboxKind =
  | 'email'
  | 'resend_email'
  | 'post'
  | 'text'
  | 'dm'
  | 'slack'
  | 'tiktok_post'
  | 'youtube_upload'
  | 'stripe_send_invoice'
  | 'stripe_send_quote'
  | 'stripe_refund'
  | 'stripe_subscription'
  | 'stripe_charge';

// ~/portfolio/outbox/<id>.json, written by bin/outbox_add.py (and bin/stripe_agent.py for money).
// Field meanings per kind are in bin/outbox.py.
export interface OutboxMessage {
  id: string;
  kind?: OutboxKind; // missing on items written before kinds existed: email
  entity: string;
  account: string; // email: which mailbox it goes out from ("resend" for resend_email); tiktok_post: the @handle
  to: string[]; // email addresses, phone numbers or @handles
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
  approved_at?: string | null;
  published_at?: string | null;
  error?: string | null;
  // resend_email: sent through Resend from a verified domain, not a mailbox
  from?: string | null;
  from_name?: string | null;
  reply_to?: string | null;
  resend_id?: string | null;
  // post / dm / slack
  channel?: string | null;
  title?: string | null;
  link?: string | null; // where it goes; after a click, where to finish it or the Stripe page
  media?: string[];
  next_step?: string | null; // what's left for the owner after the click
  // tiktok_post / youtube_upload ("yes"/"no" flags are strings so they hash like Python)
  privacy?: string | null; // tiktok: public|friends|followers|private; youtube: private|unlisted|public
  notes?: string | null; // what to do by hand after (cover frame, pinned comment)
  ai_label?: 'yes' | 'no' | null; // tiktok: TikTok's "AI-generated content" label
  schedule?: string | null; // tiktok: post on YYYY-MM-DD[THH:MM]
  tags?: string[];
  publish_at?: string | null; // youtube: private until then (local YYYY-MM-DDTHH:MM)
  category_id?: string | null;
  made_for_kids?: 'yes' | 'no' | null;
  ai_altered?: 'yes' | 'no' | null;
  // stripe_*
  stripe_id?: string | null;
  customer_id?: string | null;
  customer?: string | null;
  amount?: number | null; // minor units (cents)
  currency?: string | null;
  due_date?: string | null;
  reason?: string | null;
  action?: 'create' | 'update' | null;
  items?: string[]; // "price_...:qty"
  interval?: string | null;
  days_until_due?: number | null;
  // stripe_charge: a saved card charged off-session on the click
  payment_method?: string | null; // pm_...
  card?: string | null; // "Visa •••• 4242, exp 04/28"
  description?: string | null; // on the customer's receipt
  statement_descriptor_suffix?: string | null;
  result?: Record<string, unknown> | null;
}

// What Roo may change in an item, by kind (bin/outbox.py EDITABLE is the authority).
export type OutboxEdit = Partial<Pick<OutboxMessage, 'to' | 'cc' | 'subject' | 'body' | 'title' | 'link'>>;

export interface OutboxEntry {
  content: string; // sha256 of what is shown; Send is refused if the file changed since
  item: OutboxMessage;
}

export interface OutboxSnapshot {
  items: OutboxEntry[];
  key: string | null; // fingerprint of the send key, once Roo has made one
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
