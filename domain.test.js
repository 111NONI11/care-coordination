import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkAction, canTransition, isExpired, TASK_STATUSES, TRANSITIONS } from '../../shared/domain.js';

const future = new Date(Date.now() + 86400_000).toISOString();
const base = { status: 'unassigned', assignee_id: null, created_by: 1, due_at: future };
const jana = { id: 1, role: 'coordinator' };
const peter = { id: 2, role: 'helper' };

test('every transition targets a known status', () => {
  for (const t of Object.values(TRANSITIONS)) {
    assert.ok(TASK_STATUSES.includes(t.to));
    for (const f of t.from) assert.ok(TASK_STATUSES.includes(f));
  }
});

test('terminal statuses allow nothing', () => {
  for (const s of ['completed', 'cancelled']) {
    for (const a of Object.keys(TRANSITIONS)) assert.equal(canTransition(a, s), false, `${a} from ${s}`);
  }
});

test('accept never leads to completed', () => {
  assert.equal(TRANSITIONS.accept.to, 'accepted');
  assert.equal(canTransition('complete', 'pending_confirmation'), false);
});

test('roles', () => {
  assert.equal(checkAction('assign', base, jana), null);
  assert.equal(checkAction('assign', base, peter), 'forbidden');
  assert.equal(checkAction('claim', base, peter), null);
  const pending = { ...base, status: 'pending_confirmation', assignee_id: 2 };
  assert.equal(checkAction('accept', pending, peter), null);
  assert.equal(checkAction('accept', pending, jana), 'not_assignee');
  assert.equal(checkAction('decline', pending, peter), null);
  assert.equal(checkAction('claim', pending, peter), 'invalid_transition');
});

test('deadlines', () => {
  const past = { ...base, status: 'pending_confirmation', assignee_id: 2, due_at: new Date(Date.now() - 1000).toISOString() };
  assert.equal(isExpired(past), true);
  assert.equal(checkAction('accept', past, peter), 'deadline_passed');
  assert.equal(checkAction('decline', past, peter), null);
  assert.equal(isExpired({ ...past, status: 'completed' }), false);
});
