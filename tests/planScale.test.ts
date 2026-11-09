import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatPlanShareAt as formatPlanShare, formatShare } from '../src/utils/planShare.ts';

test('shares read well at every size', () => {
  assert.equal(formatShare(0), '0%');
  assert.equal(formatShare(0.004), '<0.01%');
  assert.equal(formatShare(0.27), '0.27%');
  assert.equal(formatShare(3.44), '3.4%');
  assert.equal(formatShare(42.6), '43%');
});

test('dollars become a share of the weekly plan, never dollars', () => {
  // A $14,874 week (11-09 reading): a $1.20 run is ~0.01%, a $520 day is 3.5%.
  assert.equal(formatPlanShare(1.2, 14874), '<0.01% of week');
  assert.equal(formatPlanShare(40, 14874), '0.27% of week');
  assert.equal(formatPlanShare(520, 14874), '3.5% of week');
  assert.equal(formatPlanShare(520, null), 'not measured yet');
  assert.ok(!formatPlanShare(520, 14874).includes('$'));
});
