// Run: npm test. The listening panel's picture rules (src/utils/attach.ts).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultQuestion, imageFile, isScreenPermissionError, wantsScreen } from '../src/utils/attach.ts';

test('asking Roo to look at the screen captures it', () => {
  for (const said of [
    'look at my screen',
    'Roo, look at my screen',
    'Hey Roo can you look at my screen and tell me what this error means',
    "what's on my screen",
    'What’s on my screen?',
    'what is on the screen right now',
    'can you see my screen',
    'check my screen',
    'read my screen',
    'what am I looking at',
    'what do you see',
    'take a screenshot',
    'grab a screenshot and tell me',
    'screenshot this',
    'help me with what\'s on my screen',
    'explain this screen',
    'look at what\'s on my screen',
    'whats on screen',
  ]) {
    assert.equal(wantsScreen(said), true, said);
  }
});

test('other questions do not', () => {
  for (const said of [
    '',
    'hi',
    "what's on my list today",
    'look at my calendar',
    'share my screen in the meeting',
    'send the screen recording to Sam',
    'check the display ads campaign',
    'what did the landlord say',
    'the screen door is broken, remind me to call a handyman',
    'look at this',
  ]) {
    assert.equal(wantsScreen(said), false, said);
  }
  assert.equal(wantsScreen('look at my screen '.repeat(40)), false, 'a long dictation is not a trigger');
});

test('an image with nothing said gets a question', () => {
  assert.equal(defaultQuestion({ path: '/a.png', thumb: '', screen: true }), "What's on my screen?");
  assert.equal(defaultQuestion({ path: '/a.png', thumb: '' }), "What's in this image?");
});

test('the permission error is recognised', () => {
  assert.equal(isScreenPermissionError("Roo can't see your screen yet. Turn on Roo in System Settings > Privacy & Security > Screen Recording, then quit and reopen Roo."), true);
  assert.equal(isScreenPermissionError(new Error('sips: failed')), false);
});

test('the first pasted image is picked', () => {
  const f = { name: 'shot.png' } as unknown as File;
  const item = (kind: string, type: string, file: File | null) => ({ kind, type, getAsFile: () => file });
  assert.equal(imageFile([item('string', 'text/plain', null), item('file', 'image/png', f)]), f);
  assert.equal(imageFile([item('file', 'application/pdf', f)]), null);
  assert.equal(imageFile([]), null);
});
