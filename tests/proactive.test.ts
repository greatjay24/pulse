// Run: npm test (node's own test runner; no extra dependencies).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { briefOpening, dedupeCalendar, draftFor, interruptFor, isQuiet, meetingInterrupt, ownerNameOf, prepOffer, preppedIds, scrub, sentenceFor } from '../src/utils/proactive.ts';

const names = { acme: 'Acme Holdings', studio: 'Studio' };
const at = new Date().toISOString();

test('quiet hours wrap midnight', () => {
  const t = (h: number, m = 0) => new Date(2026, 10, 5, h, m);
  assert.equal(isQuiet(t(22), '21:00', '08:00'), true);
  assert.equal(isQuiet(t(7, 59), '21:00', '08:00'), true);
  assert.equal(isQuiet(t(8), '21:00', '08:00'), false);
  assert.equal(isQuiet(t(13), '12:00', '14:00'), true);
  assert.equal(isQuiet(t(13), '09:00', '09:00'), false);
  assert.equal(isQuiet(t(13), 'nope', '09:00'), false);
});

test('scrub removes amounts, numbers, addresses and tokens', () => {
  const s = scrub('Balance $1,234.56 on acct 4417, call +1 (313) 555-0199, mail a@b.com, key sk_live_abcdefgh123, see https://x.y/z');
  assert.doesNotMatch(s, /\d/);
  assert.doesNotMatch(s, /@|sk_live|https/);
  assert.match(s, /an amount/);
});

test('cut titles never end on a dangling word', () => {
  const it = interruptFor({ id: 'n13', at, source: 'email', entity: 'acme', title: 'm@contoso.com: Request for Support – Brownfield Grant for the Main St site' }, names)!;
  assert.equal(it.clause, 'Contoso emailed about Request for Support – Brownfield Grant');
});

test('a human email becomes a neutral sentence with a draft offer', () => {
  const it = interruptFor({ id: 'n1', at, source: 'email', entity: 'acme', title: 'jdoe@northwind.com: RE: [EXTERNAL] Proposal update, $2,400,000' }, names)!;
  assert.equal(sentenceFor([it], 'Sam'), 'Sam, Northwind replied about proposal update. Want me to draft a response?');
  assert.equal(sentenceFor([it]), 'Northwind replied about proposal update. Want me to draft a response?');
  const gm = interruptFor({ id: 'n2', at, source: 'email', entity: 'acme', title: 'pat1234@gmail.com: Re: Warehouse Site Plan' }, names)!;
  assert.equal(gm.clause, 'a reply for Acme Holdings about Warehouse Site Plan');
  assert.match(gm.draft, /Outbox/);
});

test('bank alerts never say what they contain; automated mail stays quiet', () => {
  const bank = interruptFor({ id: 'n3', at, source: 'email', entity: 'personal', title: 'no.reply.alerts@examplebank.com: You have a new notice on an overdraft' })!;
  assert.equal(bank.clause, "there's a new account notice for you");
  assert.equal(interruptFor({ id: 'n4', at, source: 'email', entity: 'crafted', title: 'googledevelopers-noreply@google.com: [Action Advised] OAuth clients' }), null);
});

test('texts say who, never what', () => {
  const it = interruptFor({ id: 'n5', at, source: 'voice', entity: 'personal', title: 'Text from Robin: your code is 123456 and the money is $500' })!;
  assert.equal(it.clause, 'a text from Robin');
  assert.doesNotMatch(it.draft, /123456|\$500/);
});

test('money: failures speak without amounts, receipts stay quiet', () => {
  const f = interruptFor({ id: 'n6', at, source: 'stripe', entity: 'studio', title: 'Payment failed: $25.00 from Lee' }, names)!;
  assert.equal(f.clause, 'a payment for Studio failed');
  assert.equal(interruptFor({ id: 'n7', at, source: 'stripe', entity: 'studio', title: 'Payment received: $10.00 from X' }, names), null);
});

test('deadlines: decisions and tasks speak, risks and digests do not', () => {
  const d = interruptFor({ id: 'n8', at, source: 'deadlines', entity: 'acme', event_key: 'deadline:action:acme:reply', title: 'Past due (1d): Reply to Alex on the GC intro' }, names)!;
  assert.equal(d.clause, 'past due: Reply to Alex on the GC intro');
  const money = interruptFor({ id: 'n12', at, source: 'deadlines', entity: 'personal', event_key: 'task:manual-1', title: 'Back on your list today: Check bank notice: overdraft (acct 4417)' })!;
  assert.equal(money.clause, 'back on your list today: a money item for you');
  assert.equal(interruptFor({ id: 'n9', at, source: 'deadlines', entity: 'studio', event_key: 'deadline:risk:studio:mail', title: 'Due today: mail sweep fails' }), null);
  assert.equal(interruptFor({ id: 'n10', at, source: 'digest', title: 'Done without you today: 3 actions' }), null);
  assert.ok(interruptFor({ id: 'n11', at, source: 'deadlines', level: 'urgent', event_key: 'deadline:risk:x', title: 'Due today: permits' }));
});

test('meetings starting within ten minutes', () => {
  const now = Date.parse('2026-11-05T11:52:00-05:00');
  const m = meetingInterrupt({ id: 'e1', start: '2026-11-05T12:00:00-05:00', summary: 'Partner Touchpoint', people: 3, my_response: 'accepted' }, now)!;
  assert.equal(m.clause, 'Partner Touchpoint starts in 8 minutes');
  assert.match(m.id, /^[A-Za-z0-9_:.-]+$/);
  assert.equal(meetingInterrupt({ id: 'e2', start: '2026-11-05T12:30:00-05:00', people: 3 }, now), null);
  assert.equal(meetingInterrupt({ id: 'e3', start: '2026-11-05T12:00:00-05:00', people: 1 }, now), null);
  assert.equal(meetingInterrupt({ id: 'e4', start: '2026-11-05T12:00:00-05:00', people: 3, my_response: 'declined' }, now), null);
});

test('several interrupts combine into one sentence', () => {
  const mk = (c: string) => ({ id: c, at: 1, clause: c, ask: null, draft: c });
  assert.equal(sentenceFor([mk('a'), mk('b')], 'Sam'), 'Sam, two things: a and b.');
  assert.equal(sentenceFor([mk('a'), mk('b')]), 'Two things: a and b.');
  assert.equal(sentenceFor([mk('a'), mk('b'), mk('c')], 'Sam'), 'Sam, three things: a, b, and c.');
  assert.equal(sentenceFor([mk('a'), mk('b'), mk('c'), mk('d')], 'Sam'), "Sam, four things need you, starting with a and b. They're in Roo.");
  assert.match(draftFor([mk('a'), mk('b')]), /- a\n- b/);
});

test('the brief opening is its first three sentences, scrubbed', () => {
  const s = briefOpening('Good morning. Roll the Stripe key first. The client paid $4,000. Then the lender call. Then lunch.');
  assert.equal(s, 'Good morning. Roll the Stripe key first. The client paid an amount.');
});

test('the owner name comes from the registry, plain names only', () => {
  assert.equal(ownerNameOf({ front_door: { call_owner: 'Sam' } }), 'Sam');
  assert.equal(ownerNameOf({ front_door: { call_owner: 'x; rm -rf' } }), null);
  assert.equal(ownerNameOf(null), null);
});

test('meeting prep: offered at its slot, once, never after the start', () => {
  const start = new Date(2026, 10, 9, 14, 0).getTime();
  const iso = (ms: number) => new Date(ms).toISOString();
  const row = { key: '2026-11-09-northwind-review', title: 'Northwind review', start: iso(start), who: 'Sam at Northwind', spoken: 'Sam wants a date. Ask for sign-off. A third one.', status: 'ready', slots: { pre: iso(start - 10 * 60000) }, delivered: {}, ids: ['e1', 'e2'] };
  assert.equal(prepOffer(row, start - 11 * 60000, new Set()), null);
  const o = prepOffer(row, start - 10 * 60000, new Set(), 'Alex')!;
  assert.equal(o.text, 'Hey Alex, your meeting with Sam at Northwind is in 10 minutes. Want a quick brief?');
  assert.equal(o.tag, '2026-11-09-northwind-review:pre');
  assert.equal(o.spoken, 'Sam wants a date. Ask for sign-off.');
  assert.match(o.draft, /watch\/prep\/2026-11-09-northwind-review\.md/);
  assert.equal(prepOffer(row, start - 5 * 60000, new Set([o.tag])), null);
  assert.equal(prepOffer({ ...row, delivered: { pre: { via: 'telegram' } } }, start - 5 * 60000, new Set()), null);
  assert.equal(prepOffer(row, start + 1000, new Set()), null);
  assert.equal(prepOffer({ ...row, status: 'thin' }, start - 5 * 60000, new Set()), null);
});

test('meeting prep: the night before for an early meeting', () => {
  const start = new Date(2026, 10, 9, 8, 30).getTime();
  const night = new Date(2026, 10, 8, 20, 0).getTime();
  const iso = (ms: number) => new Date(ms).toISOString();
  const row = { key: '2026-11-09-investor-call', title: 'Investor call', start: iso(start), who: null, status: 'ready', slots: { night: iso(night), pre: iso(start - 600000) } };
  const o = prepOffer(row, night + 60000, new Set(), null)!;
  assert.equal(o.slot, 'night');
  assert.equal(o.text, 'Hey, Investor call is tomorrow at 8:30 am. Your brief is ready. Want a quick look?');
  assert.equal(prepOffer(row, night + 151 * 60000, new Set(), null), null);
  assert.equal(prepOffer(row, start - 300000, new Set([o.tag]), null)!.slot, 'pre');
});

test('meeting prep: covered and duplicate calendar rows stay quiet', () => {
  assert.deepEqual([...preppedIds([{ key: 'k', start: 'x', status: 'ready', ids: ['a', 'b'] }, { key: 'j', start: 'x', status: 'thin', ids: ['c'] }])], ['a', 'b']);
  const s = '2026-11-06T09:00:00-05:00';
  const rows = dedupeCalendar([{ id: 'a', start: s, summary: 'Site Grant - 12 Main St (City, Teams)' }, { id: 'b', start: s, summary: 'Site Grant - 12 Main St' }, { id: 'c', start: s, summary: 'Other thing' }]);
  assert.deepEqual(rows.map((r) => r.id), ['a', 'c']);
});
