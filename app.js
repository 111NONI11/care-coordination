import { readFile, stat } from 'node:fs/promises';
import { join, extname, normalize } from 'node:path';
import { bumpRevision, getRevision, seedDemo, tx } from './db.js';
import { createRateLimiter, createSession, destroySession, hashPassword, sessionUser, verifyPassword } from './auth.js';
import { SEED_LOCALES } from './seed-content.js';
import { checkAction, LIMITS, PHOTO_MAX_BYTES, PHOTO_TYPES, TRANSITIONS } from '../shared/domain.js';

class HttpError extends Error {
  constructor(status, code, extra) {
    super(code);
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}

const COOKIE = 'sid';
const JSON_LIMIT = 64 * 1024;
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json', '.webmanifest': 'application/manifest+json',
  '.woff2': 'font/woff2',
};

/**
 * @param {{ db: import('node:sqlite').DatabaseSync, staticDir?: string, demo?: boolean, secureCookies?: boolean, loginLimit?: number, trustProxy?: boolean }} opts
 */
export function createApp({ db, staticDir, demo = true, secureCookies = false, loginLimit = 20, trustProxy = false }) {
  const loginLimiter = createRateLimiter(loginLimit, 5 * 60_000);
  const routes = [];
  const route = (method, pattern, handler, { auth = true } = {}) => {
    const keys = [];
    const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => (keys.push(k), '(\\d+)')) + '$');
    routes.push({ method, re, keys, handler, auth });
  };

  const now = () => new Date().toISOString();

  // ---------- helpers ----------
  function membership(userId) {
    const m = db.prepare('SELECT recipient_id, role FROM memberships WHERE user_id = ? ORDER BY recipient_id LIMIT 1').get(userId);
    if (!m) throw new HttpError(403, 'no_care_circle');
    return { recipientId: m.recipient_id, role: m.role };
  }

  function str(v, field, max, { required = true } = {}) {
    if (v === undefined || v === null) v = '';
    if (typeof v !== 'string') throw new HttpError(400, 'validation', { field });
    const s = v.trim();
    if (required && !s) throw new HttpError(400, 'required', { field });
    if (s.length > max) throw new HttpError(400, 'too_long', { field, max });
    return s;
  }

  function isoDate(v, field, { required = true } = {}) {
    if ((v === null || v === undefined || v === '') && !required) return null;
    const d = new Date(v);
    if (typeof v !== 'string' || Number.isNaN(d.getTime())) throw new HttpError(400, required && !v ? 'required' : 'invalid_date', { field });
    return d.toISOString();
  }

  function hhmm(v, field) {
    if (typeof v !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(v)) throw new HttpError(400, 'invalid_time', { field });
    return v;
  }

  function getTask(ctx, id) {
    const t = db.prepare('SELECT * FROM tasks WHERE id = ? AND recipient_id = ?').get(id, ctx.recipientId);
    if (!t) throw new HttpError(404, 'not_found');
    return { ...t };
  }

  function getEvent(ctx, id) {
    const e = db.prepare('SELECT * FROM events WHERE id = ? AND recipient_id = ?').get(id, ctx.recipientId);
    if (!e) throw new HttpError(404, 'not_found');
    return { ...e };
  }

  function isMember(ctx, userId) {
    return !!db.prepare('SELECT 1 FROM memberships WHERE user_id = ? AND recipient_id = ?').get(userId, ctx.recipientId);
  }

  function requireCoordinator(ctx) {
    if (ctx.role !== 'coordinator') throw new HttpError(403, 'forbidden');
  }

  function history(taskId, type, actorId, { target = null, from = null, to = null, reason = null } = {}) {
    db.prepare('INSERT INTO task_history(task_id, type, actor_id, target_id, from_status, to_status, reason, at) VALUES (?,?,?,?,?,?,?,?)')
      .run(taskId, type, actorId, target, from, to, reason, now());
  }

  function notify(ctx, userIds, type, taskId, actorId, reason = null) {
    const ins = db.prepare('INSERT INTO notifications(user_id, recipient_id, task_id, type, actor_id, reason, created_at) VALUES (?,?,?,?,?,?,?)');
    for (const uid of new Set(userIds.filter((u) => u && u !== actorId))) ins.run(uid, ctx.recipientId, taskId, type, actorId, reason, now());
  }

  function memberIds(ctx) {
    return db.prepare('SELECT user_id FROM memberships WHERE recipient_id = ?').all(ctx.recipientId).map((r) => r.user_id);
  }

  function rows(sql, ...args) {
    return db.prepare(sql).all(...args).map((r) => ({ ...r }));
  }

  function buildState(ctx) {
    const rid = ctx.recipientId;
    const tasks = rows('SELECT id, event_id, title, due_at, notes, status, assignee_id, assigned_by, accepted_by, accepted_at, created_by, created_at, updated_at, version FROM tasks WHERE recipient_id = ? ORDER BY COALESCE(due_at, created_at)', rid);
    const taskIds = tasks.map((t) => t.id);
    const inTasks = taskIds.length ? `(${taskIds.join(',')})` : '(NULL)';
    const today = new Date();
    const from = new Date(today.getTime() - 7 * 86400_000).toISOString().slice(0, 10);
    return {
      revision: getRevision(db),
      me: { ...ctx.user, role: ctx.role },
      recipient: { ...db.prepare('SELECT id, name FROM care_recipients WHERE id = ?').get(rid) },
      members: rows('SELECT u.id, u.name, u.username, m.role FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.recipient_id = ? ORDER BY u.id', rid),
      availability: rows('SELECT id, user_id, weekday, start_time, end_time, label FROM availability WHERE recipient_id = ? ORDER BY user_id, weekday, start_time', rid),
      medications: rows('SELECT id, label, time FROM medications WHERE recipient_id = ? ORDER BY time', rid),
      medicationChecks: rows(`SELECT c.medication_id, c.date, c.checked_by, c.checked_at FROM medication_checks c
        JOIN medications m ON m.id = c.medication_id WHERE m.recipient_id = ? AND c.date >= ?`, rid, from),
      events: rows('SELECT id, title, starts_at, location, needs_transport, cancelled, created_by, created_at FROM events WHERE recipient_id = ? ORDER BY starts_at', rid)
        .map((e) => ({ ...e, needs_transport: !!e.needs_transport, cancelled: !!e.cancelled })),
      tasks,
      history: rows(`SELECT id, task_id, type, actor_id, target_id, from_status, to_status, reason, at FROM task_history WHERE task_id IN ${inTasks} ORDER BY id`),
      records: rows(`SELECT id, task_id, author_id, note, photo_id, created_at FROM visit_records WHERE task_id IN ${inTasks} ORDER BY id DESC`),
      notifications: rows('SELECT id, task_id, type, actor_id, reason, read_at, created_at FROM notifications WHERE user_id = ? AND recipient_id = ? ORDER BY id DESC LIMIT 100', ctx.user.id, rid),
    };
  }

  /** Applies a mutation atomically, bumps the revision and returns fresh state. */
  function mutate(ctx, fn) {
    const extra = tx(db, () => {
      const r = fn();
      bumpRevision(db);
      return r;
    });
    return { ...(extra && typeof extra === 'object' ? extra : {}), state: buildState(ctx) };
  }

  // ---------- auth ----------
  route('POST', '/api/auth/login', ({ body, req, res }) => {
    // Behind a hosting proxy (Render etc.) the real client IP is in X-Forwarded-For.
    const fwd = trustProxy ? String(req.headers['x-forwarded-for'] ?? '').split(',')[0].trim() : '';
    const ip = fwd || req.socket.remoteAddress || 'unknown';
    if (!loginLimiter(ip)) throw new HttpError(429, 'too_many_attempts');
    const username = str(body.username, 'username', 60);
    const password = typeof body.password === 'string' ? body.password : '';
    const user = db.prepare('SELECT id, username, name, password_hash FROM users WHERE username = ?').get(username);
    if (!user || !verifyPassword(password, user.password_hash)) throw new HttpError(401, 'bad_credentials');
    const { token, maxAge } = createSession(db, user.id);
    setCookie(res, token, maxAge);
    return { user: { id: user.id, username: user.username, name: user.name } };
  }, { auth: false });

  route('POST', '/api/auth/logout', ({ req, res }) => {
    destroySession(db, readCookie(req));
    setCookie(res, '', 0);
    return { ok: true };
  }, { auth: false });

  route('GET', '/api/config', () => ({ demo, seedLocales: SEED_LOCALES }), { auth: false });

  // ---------- state ----------
  route('GET', '/api/state', ({ ctx }) => ({ state: buildState(ctx) }));
  route('GET', '/api/revision', () => ({ revision: getRevision(db) }));

  // ---------- care circle ----------
  route('PATCH', '/api/recipient', ({ ctx, body }) => {
    requireCoordinator(ctx);
    const name = str(body.name, 'name', LIMITS.name);
    return mutate(ctx, () => db.prepare('UPDATE care_recipients SET name = ? WHERE id = ?').run(name, ctx.recipientId));
  });

  route('POST', '/api/members', ({ ctx, body }) => {
    requireCoordinator(ctx);
    const name = str(body.name, 'name', LIMITS.name);
    const username = str(body.username, 'username', 40).toLowerCase();
    if (!/^[a-z0-9._-]{3,40}$/.test(username)) throw new HttpError(400, 'invalid_username', { field: 'username' });
    const password = typeof body.password === 'string' ? body.password : '';
    if (password.length < 8) throw new HttpError(400, 'password_too_short', { field: 'password' });
    const role = body.role === 'coordinator' ? 'coordinator' : 'helper';
    if (db.prepare('SELECT 1 FROM users WHERE username = ?').get(username)) throw new HttpError(409, 'username_taken', { field: 'username' });
    return mutate(ctx, () => {
      const r = db.prepare('INSERT INTO users(username, name, password_hash, created_at) VALUES (?,?,?,?)').run(username, name, hashPassword(password), now());
      db.prepare('INSERT INTO memberships(user_id, recipient_id, role) VALUES (?,?,?)').run(Number(r.lastInsertRowid), ctx.recipientId, role);
    });
  });

  route('PATCH', '/api/members/:id', ({ ctx, body, params }) => {
    const id = Number(params.id);
    if (id !== ctx.user.id) requireCoordinator(ctx);
    if (!isMember(ctx, id)) throw new HttpError(404, 'not_found');
    const name = str(body.name, 'name', LIMITS.name);
    return mutate(ctx, () => db.prepare('UPDATE users SET name = ? WHERE id = ?').run(name, id));
  });

  route('POST', '/api/availability', ({ ctx, body }) => {
    const userId = Number(body.user_id);
    if (userId !== ctx.user.id) requireCoordinator(ctx);
    if (!isMember(ctx, userId)) throw new HttpError(404, 'not_found');
    const weekday = Number(body.weekday);
    if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) throw new HttpError(400, 'validation', { field: 'weekday' });
    const start = hhmm(body.start_time, 'start_time');
    const end = hhmm(body.end_time, 'end_time');
    if (end <= start) throw new HttpError(400, 'end_before_start', { field: 'end_time' });
    const label = body.label === 'other' ? 'other' : 'work';
    return mutate(ctx, () => db.prepare('INSERT INTO availability(recipient_id, user_id, weekday, start_time, end_time, label) VALUES (?,?,?,?,?,?)')
      .run(ctx.recipientId, userId, weekday, start, end, label));
  });

  route('DELETE', '/api/availability/:id', ({ ctx, params }) => {
    const a = db.prepare('SELECT user_id FROM availability WHERE id = ? AND recipient_id = ?').get(Number(params.id), ctx.recipientId);
    if (!a) throw new HttpError(404, 'not_found');
    if (a.user_id !== ctx.user.id) requireCoordinator(ctx);
    return mutate(ctx, () => db.prepare('DELETE FROM availability WHERE id = ?').run(Number(params.id)));
  });

  // ---------- medications ----------
  route('POST', '/api/medications', ({ ctx, body }) => {
    requireCoordinator(ctx);
    const label = str(body.label, 'label', LIMITS.name);
    const time = hhmm(body.time, 'time');
    return mutate(ctx, () => db.prepare('INSERT INTO medications(recipient_id, label, time) VALUES (?,?,?)').run(ctx.recipientId, label, time));
  });

  route('DELETE', '/api/medications/:id', ({ ctx, params }) => {
    requireCoordinator(ctx);
    const r = db.prepare('SELECT 1 FROM medications WHERE id = ? AND recipient_id = ?').get(Number(params.id), ctx.recipientId);
    if (!r) throw new HttpError(404, 'not_found');
    return mutate(ctx, () => db.prepare('DELETE FROM medications WHERE id = ?').run(Number(params.id)));
  });

  route('POST', '/api/medications/:id/check', ({ ctx, body, params }) => {
    const id = Number(params.id);
    if (!db.prepare('SELECT 1 FROM medications WHERE id = ? AND recipient_id = ?').get(id, ctx.recipientId)) throw new HttpError(404, 'not_found');
    if (typeof body.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(body.date)) throw new HttpError(400, 'invalid_date', { field: 'date' });
    return mutate(ctx, () => {
      if (body.checked) {
        db.prepare('INSERT OR REPLACE INTO medication_checks(medication_id, date, checked_by, checked_at) VALUES (?,?,?,?)').run(id, body.date, ctx.user.id, now());
      } else {
        db.prepare('DELETE FROM medication_checks WHERE medication_id = ? AND date = ?').run(id, body.date);
      }
    });
  });

  // ---------- events ----------
  function eventInput(body) {
    return {
      title: str(body.title, 'title', LIMITS.title),
      starts_at: isoDate(body.starts_at, 'starts_at'),
      location: str(body.location, 'location', LIMITS.location, { required: false }),
      needs_transport: body.needs_transport ? 1 : 0,
    };
  }

  route('POST', '/api/events', ({ ctx, body }) => {
    const e = eventInput(body);
    return mutate(ctx, () => {
      const r = db.prepare('INSERT INTO events(recipient_id, title, starts_at, location, needs_transport, created_by, created_at) VALUES (?,?,?,?,?,?,?)')
        .run(ctx.recipientId, e.title, e.starts_at, e.location, e.needs_transport, ctx.user.id, now());
      return { id: Number(r.lastInsertRowid) };
    });
  });

  route('PATCH', '/api/events/:id', ({ ctx, body, params }) => {
    const ev = getEvent(ctx, Number(params.id));
    if (ev.cancelled) throw new HttpError(409, 'event_cancelled');
    const e = eventInput(body);
    return mutate(ctx, () => db.prepare('UPDATE events SET title = ?, starts_at = ?, location = ?, needs_transport = ? WHERE id = ?')
      .run(e.title, e.starts_at, e.location, e.needs_transport, ev.id));
  });

  route('POST', '/api/events/:id/cancel', ({ ctx, params }) => {
    const ev = getEvent(ctx, Number(params.id));
    if (ev.created_by !== ctx.user.id) requireCoordinator(ctx);
    if (ev.cancelled) throw new HttpError(409, 'event_cancelled');
    return mutate(ctx, () => {
      db.prepare('UPDATE events SET cancelled = 1 WHERE id = ?').run(ev.id);
      // Open tasks for a cancelled appointment are cancelled too (history kept).
      const open = db.prepare("SELECT * FROM tasks WHERE event_id = ? AND status NOT IN ('completed','cancelled')").all(ev.id);
      for (const t of open) {
        db.prepare("UPDATE tasks SET status = 'cancelled', updated_at = ?, version = version + 1 WHERE id = ?").run(now(), t.id);
        history(t.id, 'cancelled', ctx.user.id, { from: t.status, to: 'cancelled', reason: 'event_cancelled' });
        notify(ctx, [t.assignee_id], 'cancelled', t.id, ctx.user.id);
      }
    });
  });

  // ---------- tasks ----------
  function taskInput(ctx, body) {
    const eventId = body.event_id ? Number(body.event_id) : null;
    if (eventId) {
      const ev = getEvent(ctx, eventId);
      if (ev.cancelled) throw new HttpError(409, 'event_cancelled', { field: 'event_id' });
    }
    return {
      title: str(body.title, 'title', LIMITS.title),
      event_id: eventId,
      due_at: isoDate(body.due_at, 'due_at'),
      notes: str(body.notes, 'notes', LIMITS.note, { required: false }),
    };
  }

  route('POST', '/api/tasks', ({ ctx, body }) => {
    const t = taskInput(ctx, body);
    if (new Date(t.due_at).getTime() < Date.now()) throw new HttpError(400, 'deadline_in_past', { field: 'due_at' });
    return mutate(ctx, () => {
      const ts = now();
      const r = db.prepare(`INSERT INTO tasks(recipient_id, event_id, title, due_at, notes, status, created_by, created_at, updated_at)
        VALUES (?,?,?,?,?, 'unassigned', ?,?,?)`).run(ctx.recipientId, t.event_id, t.title, t.due_at, t.notes, ctx.user.id, ts, ts);
      const id = Number(r.lastInsertRowid);
      history(id, 'created', ctx.user.id, { to: 'unassigned' });
      // "Publish to board": everyone in the circle gets a notification (S5b).
      if (body.publish) {
        history(id, 'published', ctx.user.id);
        notify(ctx, memberIds(ctx), 'needs_helper', id, ctx.user.id);
      }
      return { id };
    });
  });

  route('PATCH', '/api/tasks/:id', ({ ctx, body, params }) => {
    const task = getTask(ctx, Number(params.id));
    if (task.created_by !== ctx.user.id) requireCoordinator(ctx);
    if (task.status === 'completed' || task.status === 'cancelled') throw new HttpError(409, 'invalid_transition');
    if (body.version !== undefined && Number(body.version) !== task.version) throw new HttpError(409, 'conflict');
    const t = taskInput(ctx, body);
    return mutate(ctx, () => {
      db.prepare('UPDATE tasks SET title = ?, event_id = ?, due_at = ?, notes = ?, updated_at = ?, version = version + 1 WHERE id = ?')
        .run(t.title, t.event_id, t.due_at, t.notes, now(), task.id);
      history(task.id, 'edited', ctx.user.id);
      if (task.assignee_id) notify(ctx, [task.assignee_id], 'edited', task.id, ctx.user.id);
    });
  });

  route('POST', '/api/tasks/:id/actions', ({ ctx, body, params }) => {
    let action = String(body.action ?? '');
    const task = getTask(ctx, Number(params.id));
    let assigneeId = null;
    if (action === 'assign') {
      assigneeId = Number(body.assignee_id);
      if (!assigneeId || !isMember(ctx, assigneeId)) throw new HttpError(400, 'invalid_assignee', { field: 'assignee_id' });
      if (assigneeId === ctx.user.id) action = 'assign_self';
      else if (task.status === 'pending_confirmation' && task.assignee_id === assigneeId) throw new HttpError(409, 'already_assigned');
    }
    if (!TRANSITIONS[action]) throw new HttpError(400, 'invalid_action');
    let denied = checkAction(action, task, { id: ctx.user.id, role: ctx.role });
    // Someone else got there first: say so instead of a generic "invalid transition".
    if (action === 'claim' && denied === 'invalid_transition' && task.status !== 'cancelled' && task.status !== 'completed') denied = 'already_claimed';
    if (denied) throw new HttpError(denied === 'forbidden' || denied === 'not_assignee' ? 403 : 409, denied);
    if (body.version !== undefined && Number(body.version) !== task.version) throw new HttpError(409, 'conflict');
    const to = TRANSITIONS[action].to;
    const reason = action === 'decline' || action === 'cancel' ? str(body.reason, 'reason', LIMITS.reason, { required: false }) || null : null;

    return mutate(ctx, () => {
      const ts = now();
      // Conditional update = optimistic lock: if another request changed the task
      // in the meantime (e.g. two people pressing "Beriem to"), nothing is updated.
      const guard = 'WHERE id = ? AND version = ? AND status = ?';
      let changes;
      const exec = (sql, ...args) => (changes = db.prepare(`UPDATE tasks SET ${sql}, status = ?, updated_at = ?, version = version + 1 ${guard}`)
        .run(...args, to, ts, task.id, task.version, task.status).changes);
      switch (action) {
        case 'assign':
          exec('assignee_id = ?, assigned_by = ?, accepted_by = NULL, accepted_at = NULL', assigneeId, ctx.user.id);
          break;
        case 'assign_self':
        case 'claim':
          exec('assignee_id = ?, assigned_by = ?, accepted_by = ?, accepted_at = ?', ctx.user.id, ctx.user.id, ctx.user.id, ts);
          break;
        case 'accept':
          exec('accepted_by = ?, accepted_at = ?', ctx.user.id, ts);
          break;
        case 'unassign':
          exec('assignee_id = NULL, assigned_by = NULL, accepted_by = NULL, accepted_at = NULL');
          break;
        default:
          exec('updated_at = updated_at');
      }
      if (changes !== 1) throw new HttpError(409, action === 'claim' ? 'already_claimed' : 'conflict');

      const prevAssignee = task.assignee_id;
      switch (action) {
        case 'assign': {
          const reassign = prevAssignee && prevAssignee !== assigneeId;
          history(task.id, reassign ? 'reassigned' : 'assigned', ctx.user.id, { target: assigneeId, from: task.status, to });
          notify(ctx, [assigneeId], 'assigned', task.id, ctx.user.id);
          if (reassign && task.status === 'pending_confirmation') notify(ctx, [prevAssignee], 'unassigned', task.id, ctx.user.id);
          break;
        }
        case 'assign_self':
          history(task.id, prevAssignee ? 'reassigned' : 'assigned', ctx.user.id, { target: ctx.user.id, from: task.status, to: 'pending_confirmation' });
          history(task.id, 'accepted', ctx.user.id, { target: ctx.user.id, from: 'pending_confirmation', to });
          if (prevAssignee && task.status === 'pending_confirmation') notify(ctx, [prevAssignee], 'unassigned', task.id, ctx.user.id);
          break;
        case 'claim':
          history(task.id, 'claimed', ctx.user.id, { target: ctx.user.id, from: task.status, to });
          notify(ctx, [task.created_by], 'claimed', task.id, ctx.user.id);
          break;
        case 'accept':
          history(task.id, 'accepted', ctx.user.id, { target: ctx.user.id, from: task.status, to });
          notify(ctx, [task.assigned_by, task.created_by], 'accepted', task.id, ctx.user.id);
          break;
        case 'decline':
          // Assignee is kept on the task so the history and S10 can show who declined.
          history(task.id, 'declined', ctx.user.id, { target: ctx.user.id, from: task.status, to, reason });
          notify(ctx, [task.assigned_by, task.created_by], 'declined', task.id, ctx.user.id, reason);
          break;
        case 'unassign':
          history(task.id, 'unassigned', ctx.user.id, { target: prevAssignee, from: task.status, to });
          if (task.status === 'pending_confirmation') notify(ctx, [prevAssignee], 'unassigned', task.id, ctx.user.id);
          history(task.id, 'published', ctx.user.id);
          notify(ctx, memberIds(ctx), 'needs_helper', task.id, ctx.user.id);
          break;
        case 'complete':
          history(task.id, 'completed', ctx.user.id, { from: task.status, to });
          notify(ctx, [task.created_by, task.assignee_id], 'completed', task.id, ctx.user.id);
          break;
        case 'cancel':
          history(task.id, 'cancelled', ctx.user.id, { from: task.status, to, reason });
          notify(ctx, [task.assignee_id], 'cancelled', task.id, ctx.user.id, reason);
          break;
      }
      // Assignment requests for this task that are no longer actionable are marked read.
      if (action !== 'assign') {
        db.prepare("UPDATE notifications SET read_at = ? WHERE task_id = ? AND type IN ('assigned','needs_helper') AND read_at IS NULL AND user_id = ?")
          .run(ts, task.id, ctx.user.id);
      }
    });
  });

  // ---------- photos & records ----------
  route('POST', '/api/photos', ({ ctx, raw, req }) => {
    const mime = String(req.headers['content-type'] ?? '').split(';')[0].trim();
    if (!PHOTO_TYPES.includes(mime)) throw new HttpError(415, 'photo_type');
    if (!raw || raw.length === 0) throw new HttpError(400, 'photo_empty');
    if (raw.length > PHOTO_MAX_BYTES) throw new HttpError(413, 'photo_too_large');
    if (sniffImage(raw) !== mime) throw new HttpError(415, 'photo_type');
    return tx(db, () => {
      const r = db.prepare('INSERT INTO photos(recipient_id, mime, size, data, uploaded_by, created_at) VALUES (?,?,?,?,?,?)')
        .run(ctx.recipientId, mime, raw.length, raw, ctx.user.id, now());
      return { id: Number(r.lastInsertRowid) };
    });
  });

  route('GET', '/api/photos/:id', ({ ctx, params, res }) => {
    const p = db.prepare('SELECT mime, data FROM photos WHERE id = ? AND recipient_id = ?').get(Number(params.id), ctx.recipientId);
    if (!p) throw new HttpError(404, 'not_found');
    res.writeHead(200, { 'Content-Type': p.mime, 'Cache-Control': 'private, max-age=86400', 'X-Content-Type-Options': 'nosniff' });
    res.end(Buffer.from(p.data));
    return undefined;
  });

  route('POST', '/api/tasks/:id/records', ({ ctx, body, params }) => {
    const task = getTask(ctx, Number(params.id));
    if (!['accepted', 'completed'].includes(task.status)) throw new HttpError(409, 'invalid_transition');
    if (task.assignee_id !== ctx.user.id && ctx.role !== 'coordinator') throw new HttpError(403, 'forbidden');
    const note = str(body.note, 'note', LIMITS.note);
    let photoId = null;
    if (body.photo_id !== undefined && body.photo_id !== null) {
      photoId = Number(body.photo_id);
      const p = db.prepare('SELECT uploaded_by FROM photos WHERE id = ? AND recipient_id = ?').get(photoId, ctx.recipientId);
      if (!p || p.uploaded_by !== ctx.user.id) throw new HttpError(400, 'photo_missing', { field: 'photo' });
    }
    return mutate(ctx, () => {
      const r = db.prepare('INSERT INTO visit_records(task_id, author_id, note, photo_id, created_at) VALUES (?,?,?,?,?)')
        .run(task.id, ctx.user.id, note, photoId, now());
      history(task.id, 'record_added', ctx.user.id);
      notify(ctx, [task.created_by, task.assignee_id], 'record_added', task.id, ctx.user.id);
      return { id: Number(r.lastInsertRowid) };
    });
  });

  // ---------- notifications ----------
  route('POST', '/api/notifications/read', ({ ctx, body }) => {
    const ids = Array.isArray(body.ids) ? body.ids.map(Number).filter(Number.isInteger) : null;
    return mutate(ctx, () => {
      if (ids) {
        const st = db.prepare('UPDATE notifications SET read_at = ? WHERE id = ? AND user_id = ? AND read_at IS NULL');
        for (const id of ids) st.run(now(), id, ctx.user.id);
      } else {
        db.prepare('UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL').run(now(), ctx.user.id);
      }
    });
  });

  // ---------- demo ----------
  route('POST', '/api/demo/reset', ({ ctx, body, res }) => {
    if (!demo) throw new HttpError(404, 'not_found');
    requireCoordinator(ctx);
    const locale = SEED_LOCALES.includes(body.locale) ? body.locale : 'sk';
    const username = ctx.user.username;
    seedDemo(db, locale);
    const u = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
    if (u) {
      const { token, maxAge } = createSession(db, u.id);
      setCookie(res, token, maxAge);
    }
    return { ok: true };
  });

  // ---------- plumbing ----------
  function readCookie(req) {
    const header = req.headers.cookie ?? '';
    for (const part of header.split(';')) {
      const [k, ...v] = part.trim().split('=');
      if (k === COOKIE) return decodeURIComponent(v.join('='));
    }
    return null;
  }

  function setCookie(res, value, maxAge) {
    const parts = [`${COOKIE}=${encodeURIComponent(value)}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${maxAge}`];
    if (secureCookies) parts.push('Secure');
    res.setHeader('Set-Cookie', parts.join('; '));
  }

  async function readBody(req, limit) {
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > limit) throw new HttpError(413, req.url.startsWith('/api/photos') ? 'photo_too_large' : 'too_large');
      chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  }

  function sendJson(res, status, data) {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(data));
  }

  async function serveStatic(req, res, pathname) {
    if (!staticDir) return false;
    const safe = normalize(decodeURIComponent(pathname)).replace(/^(\.\.[/\\])+/, '');
    let file = join(staticDir, safe);
    if (!file.startsWith(staticDir)) return false;
    try {
      const s = await stat(file);
      if (s.isDirectory()) file = join(file, 'index.html');
    } catch {
      file = join(staticDir, 'index.html'); // SPA fallback
    }
    try {
      const data = await readFile(file);
      const isAsset = file.includes(`${join(staticDir, 'assets')}`);
      res.writeHead(200, {
        'Content-Type': MIME[extname(file)] ?? 'application/octet-stream',
        'Cache-Control': isAsset ? 'public, max-age=31536000, immutable' : 'no-cache',
      });
      res.end(req.method === 'HEAD' ? undefined : data);
      return true;
    } catch {
      return false;
    }
  }

  return async function handler(req, res) {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self' blob: data:; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'");
    const url = new URL(req.url, 'http://localhost');
    const { pathname } = url;
    try {
      if (!pathname.startsWith('/api/')) {
        if ((req.method === 'GET' || req.method === 'HEAD') && (await serveStatic(req, res, pathname))) return;
        throw new HttpError(404, 'not_found');
      }
      const r = routes.find((x) => x.method === req.method && x.re.test(pathname));
      if (!r) throw new HttpError(404, 'not_found');
      // CSRF defence: state-changing requests must carry a header a cross-site form cannot set.
      if (req.method !== 'GET' && req.headers['x-requested-with'] !== 'care-app') throw new HttpError(403, 'csrf');
      const match = r.re.exec(pathname);
      const params = Object.fromEntries(r.keys.map((k, i) => [k, match[i + 1]]));
      let body = {};
      let raw = null;
      if (req.method !== 'GET') {
        const isPhoto = pathname === '/api/photos';
        raw = await readBody(req, isPhoto ? PHOTO_MAX_BYTES + 1 : JSON_LIMIT);
        if (!isPhoto && raw.length) {
          try { body = JSON.parse(raw.toString('utf8')); } catch { throw new HttpError(400, 'bad_json'); }
          if (!body || typeof body !== 'object') throw new HttpError(400, 'bad_json');
        }
      }
      let ctx = null;
      if (r.auth) {
        const user = sessionUser(db, readCookie(req));
        if (!user) throw new HttpError(401, 'unauthenticated');
        ctx = { user, ...membership(user.id) };
      }
      const result = await r.handler({ req, res, ctx, body, raw, params });
      if (result !== undefined) sendJson(res, 200, result);
    } catch (e) {
      if (e instanceof HttpError) {
        sendJson(res, e.status, { error: e.code, ...(e.extra ?? {}) });
      } else {
        console.error(e);
        sendJson(res, 500, { error: 'server_error' });
      }
    }
  };
}

/** Detects the real image type from magic bytes, so a renamed file is rejected. */
function sniffImage(buf) {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf.length >= 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  return null;
}
