// Run: npm test. The voice text rules (src/utils/voiceText.ts) and the TTS daemon's sentence
// splitting (scripts/roo-tts.py, plain Python: no model needed).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { SpokenStream, choiceValue, engineOf, firstSentences, parseChoice, speakable, summaryOf } from '../src/utils/voiceText.ts';

test('engine defaults to the system voice and keeps a saved choice', () => {
  assert.equal(engineOf(undefined), 'mac');
  assert.equal(engineOf('british-1'), 'british-1');
  assert.equal(engineOf('british-2'), 'british-2');
  assert.equal(engineOf('nope'), 'mac');
});

test('settings choice round-trips', () => {
  assert.equal(choiceValue('british-1', 'Samantha'), 'roo:british-1');
  assert.equal(choiceValue('mac', null), 'mac:');
  assert.equal(choiceValue('mac', 'Eddy (English (UK))'), 'mac:Eddy (English (UK))');
  assert.deepEqual(parseChoice('roo:british-2'), { engine: 'british-2' });
  assert.deepEqual(parseChoice('mac:'), { engine: 'mac', voice: null });
  assert.deepEqual(parseChoice('mac:Samantha'), { engine: 'mac', voice: 'Samantha' });
});

test('speakable and summary are unchanged', () => {
  assert.equal(speakable('## Done\n- **Merged** [PR](https://x.y) `main`'), 'Done Merged PR main');
  assert.equal(summaryOf('First line here.\n\nSecond paragraph.'), 'First line here.');
});

const feed = (s: SpokenStream, pieces: string[]) => {
  const out = pieces.map((p) => s.push(p));
  out.push(s.end());
  return out;
};

test('a streamed reply is spoken a sentence at a time', () => {
  const out = feed(new SpokenStream(true), ['Morning Sam. Two th', 'ings are waiting. Acme', ' replied.']);
  assert.equal(out[0], 'Morning Sam. ');
  assert.equal(out[1], 'Two things are waiting. ');
  assert.equal(out[2], '');
  assert.equal(out[3], 'Acme replied.');
});

test('stream drops markdown, code and links; summary stops at the first paragraph', () => {
  const full = feed(new SpokenStream(true), ['- **Done**, see [the PR](https://x.y/1).\n```\ncode. Not spoken.\n```\n', 'Next para.']).join('');
  assert.equal(full, 'Done, see the PR. Next para.');
  const summary = feed(new SpokenStream(false), ['Short answer. More', ' detail.\n\nSecond paragraph is skipped.']).join('');
  assert.equal(summary.trim(), 'Short answer. More detail.');
});

test('spoken replies stop after two sentences; the brief (Infinity) is read whole', () => {
  const capped = feed(new SpokenStream(false, 2), ['One thing is due. The deck', ' is next. Then lunch. And more.']).join('');
  assert.equal(capped.trim(), 'One thing is due. The deck is next.');
  const brief = feed(new SpokenStream(false, Infinity), ['One. Two. Three.']).join('');
  assert.equal(brief.trim(), 'One. Two. Three.');
  assert.equal(firstSentences('A. B? C!', 2), 'A. B?');
  assert.equal(firstSentences('Only one', 2), 'Only one');
});

const py = (flag: string, input: string) => JSON.parse(execFileSync('python3', ['-I', 'scripts/roo-tts.py', flag], { input }).toString());

test('daemon splits sentences and keeps the first short', () => {
  const chunks: string[] = py('--split', 'Morning Sam. You have three things waiting: Acme replied, e.g. the pitch went out. Done!');
  assert.deepEqual(chunks, ['Morning Sam. You have three things waiting: Acme replied, e.g. the pitch went out.', 'Done!']);
  const long: string[] = py('--split', 'Word, '.repeat(60) + 'end.');
  assert.ok(long[0].length <= 140 && long.length > 1);
});

test('daemon speaks only complete sentences of a growing reply', () => {
  assert.deepEqual(py('--ready', 'One. Two th'), ['One.', 'Two th']);
  assert.deepEqual(py('--ready', 'No end yet'), ['', 'No end yet']);
});
