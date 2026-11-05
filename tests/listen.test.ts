// Run: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HOLD_MIN_MS, MAX_LISTEN_SECS, helperArgs, listeningHint, onHotkey, parseListen } from '../src/utils/listen.ts';

test('press to send is the default and pause is bounded', () => {
  assert.deepEqual(parseListen(null), { mode: 'press', pauseSecs: 2.5 });
  assert.deepEqual(parseListen('nope'), { mode: 'press', pauseSecs: 2.5 });
  assert.deepEqual(parseListen('{"mode":"pause","pauseSecs":3.14}'), { mode: 'pause', pauseSecs: 3.1 });
  assert.equal(parseListen('{"mode":"pause","pauseSecs":0.2}').pauseSecs, 2.5);
  assert.equal(parseListen('{"mode":"shout"}').mode, 'press');
});

test('only pause mode lets silence send', () => {
  assert.deepEqual(helperArgs({ mode: 'press', pauseSecs: 2.5 }), { pause: 0, max: MAX_LISTEN_SECS });
  assert.deepEqual(helperArgs({ mode: 'hold', pauseSecs: 2.5 }), { pause: 0, max: MAX_LISTEN_SECS });
  assert.deepEqual(helperArgs({ mode: 'pause', pauseSecs: 2.5 }), { pause: 2.5, max: MAX_LISTEN_SECS });
});

test('the hint says how to send', () => {
  assert.equal(listeningHint({ mode: 'press', pauseSecs: 2.5 }, '⌥⇧Space'), 'Listening. Press ⌥⇧Space again to send.');
  assert.match(listeningHint({ mode: 'hold', pauseSecs: 2.5 }, '⌥⇧Space'), /Let go of ⌥⇧Space/);
  assert.match(listeningHint({ mode: 'pause', pauseSecs: 2 }, '⌥⇧Space'), /Pause 2 s/);
});

test('the hotkey sends, restarts or waits', () => {
  const press = { mode: 'press' as const, pauseSecs: 2.5 };
  const hold = { mode: 'hold' as const, pauseSecs: 2.5 };
  assert.equal(onHotkey(press, 'pressed', 'listening', 0), 'send');
  assert.equal(onHotkey(press, 'pressed', 'typing', 0), 'send');
  assert.equal(onHotkey(press, 'pressed', 'reply', 0), 'restart');
  assert.equal(onHotkey(press, 'pressed', 'sending', 0), 'none');
  assert.equal(onHotkey(press, 'released', 'listening', 5000), 'none');
  assert.equal(onHotkey(hold, 'released', 'listening', HOLD_MIN_MS + 1), 'send');
  assert.equal(onHotkey(hold, 'released', 'listening', 100), 'none', 'a tap keeps listening');
});
