import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, client, inHours } from './helpers.js';

let srv;
before(async () => { srv = await startServer(); });
after(async () => { await srv.close(); });

const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8cfc0f01f0005000201f0b1d1a40000000049454e44ae426082', 'hex');

const task = (state, id) => state.tasks.find((t) => t.id === id);
const hist = (state, id) => state.history.filter((h) => h.task_id === id).map((h) => h.type);

test('authentication is required and CSRF header enforced', async () => {
  const anon = client(srv.base);
  assert.equal((await anon.get('/api/state')).status, 401);
  assert.equal((await anon.post('/api/auth/login', { username: 'jana', password: 'wrong' })).status, 401);
  const jana = client(srv.base);
  await jana.login('jana');
  const r = await jana.call('POST', '/api/events', { title: 'x', starts_at: inHours(5) }, { 'X-Requested-With': '' });
  assert.equal(r.status, 403);
  assert.equal(r.data.error, 'csrf');
});

test('Flow A + B(accept) + D: event → task → assign Peter → accept → visit record with photo', async () => {
  const jana = client(srv.base);
  const peter = client(srv.base);
  await jana.login('jana');
  await peter.login('peter');

  // S3 validation and save
  const bad = await jana.post('/api/events', { title: '', starts_at: inHours(48) });
  assert.equal(bad.status, 400);
  assert.equal(bad.data.field, 'title');
  const ev = await jana.post('/api/events', { title: 'Kontrola u kardiológa', starts_at: inHours(48), location: 'Nemocnica, amb. 12', needs_transport: true });
  assert.equal(ev.status, 200);
  assert.ok(ev.data.state.events.find((e) => e.id === ev.data.id && e.needs_transport));

  // S4
  const t = await jana.post('/api/tasks', { title: 'Odviezť mamu', event_id: ev.data.id, due_at: inHours(47), notes: '' });
  assert.equal(t.status, 200);
  const id = t.data.id;
  assert.equal(task(t.data.state, id).status, 'unassigned');

  // S5a → S6
  const a = await jana.post(`/api/tasks/${id}/actions`, { action: 'assign', assignee_id: 2 });
  assert.equal(a.status, 200);
  assert.equal(task(a.data.state, id).status, 'pending_confirmation');
  assert.equal(task(a.data.state, id).assignee_id, 2);

  // S7: Peter got the notification; Jana cannot accept on his behalf
  const ps = (await peter.get('/api/state')).data.state;
  assert.ok(ps.notifications.some((n) => n.type === 'assigned' && n.task_id === id && !n.read_at));
  assert.equal((await jana.post(`/api/tasks/${id}/actions`, { action: 'accept' })).status, 403);

  // S8: accept records who/when, does not complete
  const acc = await peter.post(`/api/tasks/${id}/actions`, { action: 'accept' });
  assert.equal(acc.status, 200);
  const at = task(acc.data.state, id);
  assert.equal(at.status, 'accepted');
  assert.equal(at.accepted_by, 2);
  assert.ok(at.accepted_at);
  const js = (await jana.get('/api/state')).data.state;
  assert.ok(js.notifications.some((n) => n.type === 'accepted' && n.task_id === id));

  // S11: invalid photo is rejected, valid one saved with the record
  const fake = await peter.call('POST', '/api/photos', Buffer.from('not an image'), { 'Content-Type': 'image/png' });
  assert.equal(fake.status, 415);
  const gif = await peter.call('POST', '/api/photos', Buffer.from('GIF89a'), { 'Content-Type': 'image/gif' });
  assert.equal(gif.status, 415);
  const big = await peter.call('POST', '/api/photos', Buffer.concat([PNG, Buffer.alloc(5 * 1024 * 1024)]), { 'Content-Type': 'image/png' });
  assert.equal(big.status, 413);
  const photo = await peter.call('POST', '/api/photos', PNG, { 'Content-Type': 'image/png' });
  assert.equal(photo.status, 200);
  const emptyNote = await peter.post(`/api/tasks/${id}/records`, { note: '  ' });
  assert.equal(emptyNote.status, 400);
  const rec = await peter.post(`/api/tasks/${id}/records`, { note: 'Všetko v poriadku', photo_id: photo.data.id });
  assert.equal(rec.status, 200);
  assert.ok(rec.data.state.records.some((r) => r.task_id === id && r.photo_id === photo.data.id));
  const img = await jana.get(`/api/photos/${photo.data.id}`);
  assert.equal(img.status, 200);
  assert.equal(Buffer.from(img.data).length, PNG.length);

  // complete is a separate, explicit step
  const done = await peter.post(`/api/tasks/${id}/actions`, { action: 'complete' });
  assert.equal(task(done.data.state, id).status, 'completed');
  assert.deepEqual(hist(done.data.state, id), ['created', 'assigned', 'accepted', 'record_added', 'completed']);
  assert.equal((await peter.post(`/api/tasks/${id}/actions`, { action: 'accept' })).status, 409);
});

test('Flow B(decline) + reassignment keeps history', async () => {
  const jana = client(srv.base);
  const peter = client(srv.base);
  const eva = client(srv.base);
  await jana.login('jana');
  await peter.login('peter');
  await eva.login('eva');
  const id = (await jana.post('/api/tasks', { title: 'Odviezť mamu', due_at: inHours(30) })).data.id;
  await jana.post(`/api/tasks/${id}/actions`, { action: 'assign', assignee_id: 2 });
  // Eva is not the assignee
  assert.equal((await eva.post(`/api/tasks/${id}/actions`, { action: 'decline' })).status, 403);
  const d = await peter.post(`/api/tasks/${id}/actions`, { action: 'decline', reason: 'som v práci' });
  assert.equal(d.status, 200);
  const dt = task(d.data.state, id);
  assert.equal(dt.status, 'rejected');
  assert.equal(dt.accepted_at, null);
  const js = (await jana.get('/api/state')).data.state;
  const n = js.notifications.find((x) => x.type === 'declined' && x.task_id === id);
  assert.equal(n.reason, 'som v práci');
  // S10 → S5a: reassign to Eva
  const r = await jana.post(`/api/tasks/${id}/actions`, { action: 'assign', assignee_id: 3 });
  assert.equal(task(r.data.state, id).status, 'pending_confirmation');
  assert.equal(task(r.data.state, id).assignee_id, 3);
  const h = r.data.state.history.filter((x) => x.task_id === id);
  assert.deepEqual(h.map((x) => x.type), ['created', 'assigned', 'declined', 'reassigned']);
  assert.equal(h[2].reason, 'som v práci');
  assert.equal(h[3].target_id, 3);
  // Peter can no longer act on it
  assert.equal((await peter.post(`/api/tasks/${id}/actions`, { action: 'accept' })).status, 403);
  assert.equal((await eva.post(`/api/tasks/${id}/actions`, { action: 'accept' })).status, 200);
});

test('Flow C: claiming from the board, concurrent claims only succeed once', async () => {
  const jana = client(srv.base);
  const peter = client(srv.base);
  const eva = client(srv.base);
  await jana.login('jana');
  await peter.login('peter');
  await eva.login('eva');
  const created = await jana.post('/api/tasks', { title: 'Nákup liekov', due_at: inHours(24), publish: true });
  const id = created.data.id;
  const es = (await eva.get('/api/state')).data.state;
  assert.ok(es.notifications.some((n) => n.type === 'needs_helper' && n.task_id === id));
  const results = await Promise.all([
    peter.post(`/api/tasks/${id}/actions`, { action: 'claim' }),
    eva.post(`/api/tasks/${id}/actions`, { action: 'claim' }),
  ]);
  const statuses = results.map((r) => r.status).sort();
  assert.deepEqual(statuses, [200, 409]);
  const loser = results.find((r) => r.status === 409);
  assert.equal(loser.data.error, 'already_claimed');
  const s = (await jana.get('/api/state')).data.state;
  const t = task(s, id);
  assert.equal(t.status, 'accepted');
  assert.ok([2, 3].includes(t.assignee_id));
  assert.equal(t.accepted_by, t.assignee_id);
  assert.ok(s.notifications.some((n) => n.type === 'claimed' && n.task_id === id));
});

test('optimistic version check rejects stale updates', async () => {
  const jana = client(srv.base);
  await jana.login('jana');
  const c = await jana.post('/api/tasks', { title: 'Stale', due_at: inHours(10) });
  const v = task(c.data.state, c.data.id).version;
  assert.equal((await jana.post(`/api/tasks/${c.data.id}/actions`, { action: 'assign', assignee_id: 2, version: v })).status, 200);
  const stale = await jana.post(`/api/tasks/${c.data.id}/actions`, { action: 'assign', assignee_id: 3, version: v });
  assert.equal(stale.status, 409);
  assert.equal(stale.data.error, 'conflict');
});

test('expired deadlines, cancelled tasks and invalid transitions are refused', async () => {
  const jana = client(srv.base);
  const peter = client(srv.base);
  await jana.login('jana');
  await peter.login('peter');
  assert.equal((await jana.post('/api/tasks', { title: 'Past', due_at: inHours(-1) })).data.error, 'deadline_in_past');
  const id = (await jana.post('/api/tasks', { title: 'Soon', due_at: inHours(1) })).data.id;
  await jana.post(`/api/tasks/${id}/actions`, { action: 'assign', assignee_id: 2 });
  // Simulate the deadline passing.
  srv.db.prepare('UPDATE tasks SET due_at = ? WHERE id = ?').run(inHours(-2), id);
  const late = await peter.post(`/api/tasks/${id}/actions`, { action: 'accept' });
  assert.equal(late.status, 409);
  assert.equal(late.data.error, 'deadline_passed');
  // Helpers cannot cancel; coordinator can, and then everything is refused.
  assert.equal((await peter.post(`/api/tasks/${id}/actions`, { action: 'cancel' })).status, 403);
  assert.equal((await jana.post(`/api/tasks/${id}/actions`, { action: 'cancel' })).status, 200);
  assert.equal((await jana.post(`/api/tasks/${id}/actions`, { action: 'assign', assignee_id: 3 })).data.error, 'invalid_transition');
  assert.equal((await jana.post(`/api/tasks/${id}/actions`, { action: 'fly' })).data.error, 'invalid_action');
  assert.equal((await jana.post('/api/tasks/99999/actions', { action: 'cancel' })).status, 404);
});

test('cancelling an event cancels its open tasks', async () => {
  const jana = client(srv.base);
  await jana.login('jana');
  const ev = await jana.post('/api/events', { title: 'Zubár', starts_at: inHours(72) });
  const t = await jana.post('/api/tasks', { title: 'Odvoz', event_id: ev.data.id, due_at: inHours(71) });
  const r = await jana.post(`/api/events/${ev.data.id}/cancel`);
  assert.equal(task(r.data.state, t.data.id).status, 'cancelled');
  assert.equal((await jana.post('/api/tasks', { title: 'x', event_id: ev.data.id, due_at: inHours(5) })).data.error, 'event_cancelled');
});

test('data is isolated to members of the care circle', async () => {
  const jana = client(srv.base);
  await jana.login('jana');
  await jana.post('/api/members', { name: 'Cudzí', username: 'outsider', password: 'password123' });
  // Remove the new user from the circle to simulate an unrelated account.
  srv.db.prepare("DELETE FROM memberships WHERE user_id = (SELECT id FROM users WHERE username = 'outsider')").run();
  const out = client(srv.base);
  await out.login('outsider', 'password123');
  assert.equal((await out.get('/api/state')).status, 403);
  assert.equal((await out.get('/api/photos/1')).status, 403);
  // Helpers cannot add members
  const peter = client(srv.base);
  await peter.login('peter');
  assert.equal((await peter.post('/api/members', { name: 'X', username: 'xxx', password: 'password123' })).status, 403);
});
