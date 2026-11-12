import { test } from 'node:test';
import assert from 'node:assert/strict';
import { connectSteps, maskAccount } from '../src/utils/connectors.ts';

test('accounts are masked, never shown whole', () => {
  assert.equal(maskAccount('owner@acme.example'), 'ow•••@acme.example');
  assert.equal(maskAccount('a@x.io'), 'a•••@x.io');
  assert.equal(maskAccount('acme-studio'), 'acm•••');
  assert.equal(maskAccount('bob'), 'bob');
});

test('connect accepts one step or a list and drops empty ones', () => {
  assert.deepEqual(connectSteps(undefined), []);
  assert.deepEqual(connectSteps({ terminal: ['gh', 'auth', 'login'] }), [{ terminal: ['gh', 'auth', 'login'] }]);
  assert.deepEqual(connectSteps([{ label: 'x' }, { url: 'https://example.com' }, { terminal: [] }]), [{ url: 'https://example.com' }]);
});
