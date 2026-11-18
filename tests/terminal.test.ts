// Run: npm test. The Terminal page's rules (src/utils/terminal.ts).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  businessColor,
  businessOf,
  claudeState,
  defaultName,
  nextAfterClose,
  pageKey,
  restorable,
  shortPath,
  tabForIndex,
  tabId,
  zoomed,
  type TermEntry,
} from '../src/utils/terminal.ts';

const entry = (over: Partial<TermEntry>): TermEntry => ({
  id: 'x',
  kind: 'tmux',
  label: 'x',
  tmux: null,
  tty: null,
  cwd: null,
  claude: null,
  clients: 0,
  activity: null,
  ...over,
});

test('business comes from the open-sessions name', () => {
  assert.equal(businessOf('Visuo · Give It a Try'), 'Visuo');
  assert.equal(businessColor('Visuo · Give It a Try'), '#8a46d6');
  assert.equal(businessColor('Crafted · Willis'), '#d64545');
  assert.equal(businessOf('scratch'), null);
  assert.equal(businessColor('Unknown · thing'), null);
});

test('claude status reads as words', () => {
  assert.deepEqual(claudeState({ name: 'Roo', status: 'busy', pid: 1 }), { text: 'working', tone: 'busy' });
  assert.deepEqual(claudeState({ name: 'Roo', status: 'idle', pid: 1 }), { text: 'waiting for you', tone: 'waiting' });
  assert.equal(claudeState(null), null);
});

test('paths shorten to the home folder', () => {
  assert.equal(shortPath('/Users/j/Visuo', '/Users/j'), '~/Visuo');
  assert.equal(shortPath('/Users/j', '/Users/j'), '~');
  assert.equal(shortPath('/Users/jay/x', '/Users/j'), '/Users/jay/x');
  assert.equal(shortPath(null, '/Users/j'), '');
});

test('saved tabs come back only for sessions still running', () => {
  const entries = [entry({ id: 'tmux:a', tmux: 'a' }), entry({ id: 'tmux:b', tmux: 'b' }), entry({ id: 'tty:/dev/ttys1', kind: 'terminal', tty: '/dev/ttys1' })];
  assert.deepEqual(restorable(['a', 'gone', 'a', 'b', 3], entries), [
    { kind: 'tmux', name: 'a' },
    { kind: 'tmux', name: 'b' },
  ]);
  assert.deepEqual(restorable('nope', entries), []);
  assert.equal(tabId({ kind: 'peek', tty: '/dev/ttys1', label: 'Roo' }), 'tty:/dev/ttys1');
});

test('closing a tab moves to its neighbour', () => {
  assert.equal(nextAfterClose(['a', 'b', 'c'], 'b', 'b'), 'c');
  assert.equal(nextAfterClose(['a', 'b', 'c'], 'c', 'c'), 'b');
  assert.equal(nextAfterClose(['a'], 'a', 'a'), null);
  assert.equal(nextAfterClose(['a', 'b'], 'a', 'b'), 'b', 'closing a background tab keeps the active one');
});

test('page keys: cmd-T, cmd-W, cmd-1..9, find, zoom; nothing else', () => {
  const k = (key: string, mods: Partial<{ metaKey: boolean; ctrlKey: boolean; altKey: boolean; shiftKey: boolean }> = {}) =>
    pageKey({ metaKey: true, ctrlKey: false, altKey: false, shiftKey: false, key, ...mods });
  assert.deepEqual(k('t'), { do: 'new' });
  assert.deepEqual(k('W'), { do: 'close' });
  assert.deepEqual(k('3'), { do: 'tab', index: 2 });
  assert.deepEqual(k('f'), { do: 'find' });
  assert.deepEqual(k('='), { do: 'zoom', by: 1 });
  assert.deepEqual(k('+', { shiftKey: true }), { do: 'zoom', by: 1 });
  assert.equal(k('c'), null, 'copy stays with the terminal');
  assert.equal(k('v'), null, 'paste stays with the terminal');
  assert.equal(k('k'), null, 'cmd-K stays Roo\'s');
  assert.equal(k('t', { metaKey: false, ctrlKey: true }), null, 'ctrl-T goes to the program');
  assert.equal(k('t', { altKey: true }), null);
});

test('cmd-9 is the last tab', () => {
  assert.equal(tabForIndex(4, 8), 3);
  assert.equal(tabForIndex(4, 1), 1);
  assert.equal(tabForIndex(4, 5), null);
  assert.equal(tabForIndex(0, 0), null);
});

test('new terminals are named after their folder unless named', () => {
  assert.equal(defaultName('  Willis fix ', 'Crafted'), 'Willis fix');
  assert.equal(defaultName('', 'Portfolio (org)'), 'Portfolio');
  assert.equal(defaultName('', ''), 'Terminal');
});

test('text size stays in range', () => {
  assert.equal(zoomed(12, 1), 13);
  assert.equal(zoomed(24, 1), 24);
  assert.equal(zoomed(9, -1), 9);
  assert.equal(zoomed(20, 0), 12);
});
