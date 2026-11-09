// Run: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CONVERSE_IDLE_MS,
  Converse,
  ECHO_TAIL_MS,
  HOLD_MIN_MS,
  MAX_LISTEN_SECS,
  finalText,
  helperArgs,
  isBargeIn,
  isStopPhrase,
  listeningHint,
  onHotkey,
  parseListen,
  stripEcho,
} from '../src/utils/listen.ts';

const base = { converse: false, endpointSecs: 1 };

test('press to send is the default and pause is bounded', () => {
  assert.deepEqual(parseListen(null), { mode: 'press', pauseSecs: 2.5, converse: false, endpointSecs: 1 });
  assert.deepEqual(parseListen('nope'), { mode: 'press', pauseSecs: 2.5, converse: false, endpointSecs: 1 });
  assert.deepEqual(parseListen('{"mode":"pause","pauseSecs":3.14}'), { mode: 'pause', pauseSecs: 3.1, converse: false, endpointSecs: 1 });
  assert.equal(parseListen('{"mode":"pause","pauseSecs":0.2}').pauseSecs, 2.5);
  assert.equal(parseListen('{"mode":"shout"}').mode, 'press');
});

test('conversation mode is off by default and its pause is bounded', () => {
  assert.equal(parseListen('{"converse":true}').converse, true);
  assert.equal(parseListen('{"converse":"yes"}').converse, false);
  assert.equal(parseListen('{"endpointSecs":1.24}').endpointSecs, 1.2);
  assert.equal(parseListen('{"endpointSecs":0.1}').endpointSecs, 1);
  assert.equal(parseListen('{"endpointSecs":9}').endpointSecs, 1);
});

test('only pause mode lets silence send', () => {
  assert.deepEqual(helperArgs({ mode: 'press', pauseSecs: 2.5, ...base }), { pause: 0, max: MAX_LISTEN_SECS });
  assert.deepEqual(helperArgs({ mode: 'hold', pauseSecs: 2.5, ...base }), { pause: 0, max: MAX_LISTEN_SECS });
  assert.deepEqual(helperArgs({ mode: 'pause', pauseSecs: 2.5, ...base }), { pause: 2.5, max: MAX_LISTEN_SECS });
});

test('the hint says how to send', () => {
  assert.equal(listeningHint({ mode: 'press', pauseSecs: 2.5, ...base }, '⌥⇧Space'), 'Listening. Press ⌥⇧Space again to send.');
  assert.match(listeningHint({ mode: 'hold', pauseSecs: 2.5, ...base }, '⌥⇧Space'), /Let go of ⌥⇧Space/);
  assert.match(listeningHint({ mode: 'pause', pauseSecs: 2, ...base }, '⌥⇧Space'), /Pause 2 s/);
});

test('the hotkey sends, restarts or waits', () => {
  const press = { mode: 'press' as const, pauseSecs: 2.5, ...base };
  const hold = { mode: 'hold' as const, pauseSecs: 2.5, ...base };
  assert.equal(onHotkey(press, 'pressed', 'listening', 0), 'send');
  assert.equal(onHotkey(press, 'pressed', 'typing', 0), 'send');
  assert.equal(onHotkey(press, 'pressed', 'reply', 0), 'restart');
  assert.equal(onHotkey(press, 'pressed', 'sending', 0), 'none');
  assert.equal(onHotkey(press, 'released', 'listening', 5000), 'none');
  assert.equal(onHotkey(hold, 'released', 'listening', HOLD_MIN_MS + 1), 'send');
  assert.equal(onHotkey(hold, 'released', 'listening', 100), 'none', 'a tap keeps listening');
});

test('an emptier final never wipes what was said', () => {
  assert.equal(finalText('', 'What is on my list'), 'What is on my list');
  assert.equal(finalText('second part', 'first part second part'), 'first part second part');
  assert.equal(finalText('What is on my list today?', 'what is on my list today'), 'What is on my list today?');
  assert.equal(finalText('I want to clean this up', 'I wanna clean this up'), 'I want to clean this up');
  assert.equal(finalText('hi', ''), 'hi');
});

// ---- conversation mode ----

const ROO = 'Your next meeting is at three with Sam, in the Willis office. Want me to move it?';

test('echo: what Roo said is dropped, what the owner said is kept', () => {
  assert.equal(stripEcho('your next meeting is at three with Sam', ROO), '');
  assert.equal(stripEcho('Your next', ROO), '', 'a short start of Roo is echo');
  assert.equal(stripEcho('your next meeting is that three', ROO), '', 'one misheard word inside echo');
  assert.equal(stripEcho('meeting is at three with Sam wait what about tomorrow', ROO), 'wait what about tomorrow');
  assert.equal(stripEcho('What is on my list today', ROO), 'What is on my list today', 'nothing in common');
  assert.equal(stripEcho('is it at three', ROO), 'is it at three', 'two words in common is just English');
  assert.equal(stripEcho('anything', ''), 'anything');
  assert.equal(stripEcho('', ROO), '');
});

test('stop phrases and barge-in', () => {
  for (const s of ['stop', 'Stop.', 'hey Roo, wait', 'okay stop', 'stop stop', 'never mind', 'hold on please']) assert.ok(isStopPhrase(s), s);
  for (const s of ['stop the meeting', 'what about tomorrow', 'okay', 'roo']) assert.ok(!isStopPhrase(s), s);
  assert.ok(isBargeIn('stop'));
  assert.ok(isBargeIn('what about'));
  assert.ok(!isBargeIn('um'));
  assert.ok(!isBargeIn(''));
});

test('a turn ends on a pause and is sent', () => {
  const c = new Converse(1, 0);
  assert.equal(c.partial(0, 'what is', 100, false, ''), null);
  assert.equal(c.partial(0, 'what is on my list', 400, false, ''), null);
  assert.equal(c.tick(1300, false, ''), null, 'not yet a full pause');
  assert.deepEqual(c.tick(1400, false, ''), { type: 'send', text: 'what is on my list' });
  assert.equal(c.tick(3000, false, ''), null, 'nothing heard since');
  assert.equal(c.partial(0, 'what is on my list', 3100, false, ''), null, 'a late partial of the sent turn is ignored');
  assert.equal(c.tick(5000, false, ''), null);
  c.partial(1, 'and tomorrow', 5100, false, '');
  assert.deepEqual(c.tick(6100, false, ''), { type: 'send', text: 'and tomorrow' });
});

test('the endpoint is tunable', () => {
  const c = new Converse(0.8, 0);
  c.partial(0, 'hello', 0, false, '');
  assert.deepEqual(c.tick(800, false, ''), { type: 'send', text: 'hello' });
});

test("Roo's own voice never becomes a turn", () => {
  const c = new Converse(1, 0);
  assert.equal(c.partial(0, 'your next meeting', 100, true, ROO), null);
  assert.equal(c.partial(0, 'your next meeting is at three with Sam', 900, true, ROO), null, 'echo is not a barge-in');
  assert.equal(c.tick(1500, true, ROO), null);
  assert.deepEqual(c.tick(2000, false, ROO), { type: 'discard' });
});

test('echo heard just after Roo stops is still echo', () => {
  const c = new Converse(1, 0);
  c.tick(1000, true, ROO); // Roo's last word
  c.tick(1100, false, ROO); // Roo done
  assert.equal(c.partial(0, 'in the Willis office', 1000 + ECHO_TAIL_MS - 100, false, ROO), null);
  assert.deepEqual(c.tick(1000 + ECHO_TAIL_MS + 1000, false, ROO), { type: 'discard' });
  // Later, the owner can quote Roo freely.
  c.partial(1, 'move the meeting with Sam at three', 10_000, false, ROO);
  assert.deepEqual(c.tick(11_000, false, ROO), { type: 'send', text: 'move the meeting with Sam at three' });
});

test('barge-in: the owner talking over Roo stops it once and becomes the next turn', () => {
  const c = new Converse(1, 0);
  assert.equal(c.partial(0, 'your next meeting is at three', 100, true, ROO), null);
  assert.deepEqual(c.partial(0, 'your next meeting is at three wait what about', 600, true, ROO), { type: 'barge' });
  assert.equal(c.partial(0, 'your next meeting is at three wait what about tomorrow', 900, false, ROO), null, 'only once');
  assert.equal(c.own(ROO), 'wait what about tomorrow');
  assert.deepEqual(c.tick(1900, false, ROO), { type: 'send', text: 'wait what about tomorrow' });
});

test('"stop" stops Roo and sends nothing', () => {
  const c = new Converse(1, 0);
  assert.deepEqual(c.partial(0, 'stop', 200, true, ROO), { type: 'barge' });
  assert.deepEqual(c.tick(1300, false, ROO), { type: 'discard' });
});

test('the hotkey takes the turn at once', () => {
  const c = new Converse(1, 0);
  assert.equal(c.takeNow(0, ''), null, 'nothing heard yet');
  c.partial(0, 'send this now', 100, false, '');
  assert.deepEqual(c.takeNow(200, ''), { type: 'send', text: 'send this now' });
});

test('five quiet minutes turn it off; Roo talking or working keeps it on', () => {
  const c = new Converse(1, 0);
  assert.equal(c.tick(CONVERSE_IDLE_MS - 1, false, ''), null);
  c.touch(CONVERSE_IDLE_MS - 1); // Roo still working on an answer
  assert.equal(c.tick(CONVERSE_IDLE_MS + 1000, false, ''), null);
  c.tick(2 * CONVERSE_IDLE_MS, true, ''); // Roo talking
  assert.equal(c.tick(3 * CONVERSE_IDLE_MS - 1, false, ''), null);
  assert.deepEqual(c.tick(3 * CONVERSE_IDLE_MS, false, ''), { type: 'idle' });
});
