import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { hashPassword } from './auth.js';
import { seedContent } from './seed-content.js';

const SCHEMA = `
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS care_recipients (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS memberships (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  recipient_id INTEGER NOT NULL REFERENCES care_recipients(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('coordinator','helper')),
  PRIMARY KEY (user_id, recipient_id)
);
CREATE TABLE IF NOT EXISTS availability (
  id INTEGER PRIMARY KEY,
  recipient_id INTEGER NOT NULL REFERENCES care_recipients(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  weekday INTEGER NOT NULL CHECK (weekday BETWEEN 0 AND 6),
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  label TEXT NOT NULL DEFAULT 'work'
);
CREATE TABLE IF NOT EXISTS medications (
  id INTEGER PRIMARY KEY,
  recipient_id INTEGER NOT NULL REFERENCES care_recipients(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  time TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS medication_checks (
  medication_id INTEGER NOT NULL REFERENCES medications(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  checked_by INTEGER NOT NULL REFERENCES users(id),
  checked_at TEXT NOT NULL,
  PRIMARY KEY (medication_id, date)
);
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY,
  recipient_id INTEGER NOT NULL REFERENCES care_recipients(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  starts_at TEXT NOT NULL,
  location TEXT NOT NULL DEFAULT '',
  needs_transport INTEGER NOT NULL DEFAULT 0,
  cancelled INTEGER NOT NULL DEFAULT 0,
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS tasks (
  id INTEGER PRIMARY KEY,
  recipient_id INTEGER NOT NULL REFERENCES care_recipients(id) ON DELETE CASCADE,
  event_id INTEGER REFERENCES events(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  due_at TEXT,
  notes TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL CHECK (status IN ('unassigned','pending_confirmation','accepted','rejected','completed','cancelled')),
  assignee_id INTEGER REFERENCES users(id),
  assigned_by INTEGER REFERENCES users(id),
  accepted_by INTEGER REFERENCES users(id),
  accepted_at TEXT,
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS task_history (
  id INTEGER PRIMARY KEY,
  task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  actor_id INTEGER REFERENCES users(id),
  target_id INTEGER REFERENCES users(id),
  from_status TEXT,
  to_status TEXT,
  reason TEXT,
  at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS photos (
  id INTEGER PRIMARY KEY,
  recipient_id INTEGER NOT NULL REFERENCES care_recipients(id) ON DELETE CASCADE,
  mime TEXT NOT NULL,
  size INTEGER NOT NULL,
  data BLOB NOT NULL,
  uploaded_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS visit_records (
  id INTEGER PRIMARY KEY,
  task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  author_id INTEGER NOT NULL REFERENCES users(id),
  note TEXT NOT NULL,
  photo_id INTEGER REFERENCES photos(id),
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  recipient_id INTEGER NOT NULL REFERENCES care_recipients(id) ON DELETE CASCADE,
  task_id INTEGER REFERENCES tasks(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  actor_id INTEGER REFERENCES users(id),
  reason TEXT,
  read_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tasks_recipient ON tasks(recipient_id);
CREATE INDEX IF NOT EXISTS idx_history_task ON task_history(task_id);
CREATE INDEX IF NOT EXISTS idx_notif_user ON notifications(user_id);
`;

export function openDb(path) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(SCHEMA);
  if (path !== ':memory:') db.exec('PRAGMA journal_mode = WAL;');
  const has = db.prepare('SELECT COUNT(*) AS n FROM users').get();
  if (has.n === 0) seedDemo(db, 'sk');
  return db;
}

/** Runs fn inside a transaction (node:sqlite is synchronous, so this is atomic). */
export function tx(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

export function bumpRevision(db) {
  db.prepare(
    `INSERT INTO meta(key, value) VALUES ('revision', '1')
     ON CONFLICT(key) DO UPDATE SET value = CAST(value AS INTEGER) + 1`,
  ).run();
}

export function getRevision(db) {
  const row = db.prepare("SELECT value FROM meta WHERE key = 'revision'").get();
  return row ? Number(row.value) : 0;
}

/** Next given weekday (1 = Monday ... 5 = Friday) strictly after `from`, at local hh:mm. */
function nextWeekday(from, weekday, h, m) {
  const d = new Date(from);
  d.setHours(h, m, 0, 0);
  const diff = (weekday - d.getDay() + 7) % 7 || 7;
  d.setDate(d.getDate() + diff);
  return d;
}

export const DEMO_PASSWORD = 'demo1234';

/**
 * Wipes all care data and recreates the demo circle (Mama, Jana, Peter, Eva)
 * with texts in the given locale. Dates are relative to now so the demo never goes stale.
 */
export function seedDemo(db, locale = 'sk', now = new Date()) {
  const c = seedContent(locale);
  const iso = now.toISOString();
  tx(db, () => {
    for (const t of ['notifications', 'visit_records', 'photos', 'task_history', 'tasks', 'events',
      'medication_checks', 'medications', 'availability', 'memberships', 'care_recipients', 'sessions', 'users']) {
      db.exec(`DELETE FROM ${t}`);
    }
    const hash = hashPassword(DEMO_PASSWORD);
    const addUser = db.prepare('INSERT INTO users(id, username, name, password_hash, created_at) VALUES (?,?,?,?,?)');
    addUser.run(1, 'jana', c.users.jana, hash, iso);
    addUser.run(2, 'peter', c.users.peter, hash, iso);
    addUser.run(3, 'eva', c.users.eva, hash, iso);
    db.prepare('INSERT INTO care_recipients(id, name, created_at) VALUES (1, ?, ?)').run(c.recipient, iso);
    const member = db.prepare('INSERT INTO memberships(user_id, recipient_id, role) VALUES (?, 1, ?)');
    member.run(1, 'coordinator');
    member.run(2, 'helper');
    member.run(3, 'helper');
    // Eva works Monday–Friday 7:00–16:00 ("v práci" in the prototype); Peter and Jana are free.
    const avail = db.prepare('INSERT INTO availability(recipient_id, user_id, weekday, start_time, end_time, label) VALUES (1, 3, ?, ?, ?, ?)');
    for (let wd = 1; wd <= 5; wd++) avail.run(wd, '07:00', '16:00', 'work');
    const med = db.prepare('INSERT INTO medications(recipient_id, label, time) VALUES (1, ?, ?)');
    med.run(c.medMorning, '08:00');
    med.run(c.medEvening, '20:00');

    const cardio = nextWeekday(now, 5, 9, 0);
    db.prepare(`INSERT INTO events(id, recipient_id, title, starts_at, location, needs_transport, created_by, created_at)
      VALUES (1, 1, ?, ?, ?, 1, 1, ?)`).run(c.cardioTitle, cardio.toISOString(), c.cardioLocation, iso);

    const past = new Date(now);
    past.setDate(past.getDate() - 3);
    past.setHours(10, 0, 0, 0);
    db.prepare(`INSERT INTO events(id, recipient_id, title, starts_at, location, needs_transport, created_by, created_at)
      VALUES (2, 1, ?, ?, ?, 1, 1, ?)`).run(c.bloodTitle, past.toISOString(), c.bloodLocation, iso);

    const shopDue = new Date(now);
    shopDue.setDate(shopDue.getDate() + 1);
    shopDue.setHours(17, 0, 0, 0);
    const insTask = db.prepare(`INSERT INTO tasks(id, recipient_id, event_id, title, due_at, notes, status, assignee_id, assigned_by,
      accepted_by, accepted_at, created_by, created_at, updated_at) VALUES (?,1,?,?,?,?,?,?,?,?,?,1,?,?)`);
    insTask.run(1, null, c.shopTitle, shopDue.toISOString(), c.shopNotes, 'unassigned', null, null, null, null, iso, iso);
    const at = (base, hours) => new Date(base.getTime() + hours * 3600_000).toISOString();
    const pastDue = at(past, -0.75);
    const created = at(past, -72);
    const accepted = at(past, -70);
    const visited = at(past, 2);
    db.prepare(`INSERT INTO tasks(id, recipient_id, event_id, title, due_at, notes, status, assignee_id, assigned_by,
      accepted_by, accepted_at, created_by, created_at, updated_at) VALUES (2,1,2,?,?,'','completed',2,1,2,?,1,?,?)`)
      .run(c.bloodTask, pastDue, accepted, created, visited);

    const hist = db.prepare('INSERT INTO task_history(task_id, type, actor_id, target_id, from_status, to_status, at) VALUES (?,?,?,?,?,?,?)');
    hist.run(1, 'created', 1, null, null, 'unassigned', iso);
    hist.run(2, 'created', 1, null, null, 'unassigned', created);
    hist.run(2, 'assigned', 1, 2, 'unassigned', 'pending_confirmation', created);
    hist.run(2, 'accepted', 2, 2, 'pending_confirmation', 'accepted', accepted);
    hist.run(2, 'record_added', 2, null, null, null, visited);
    hist.run(2, 'completed', 2, null, 'accepted', 'completed', visited);
    db.prepare('INSERT INTO visit_records(task_id, author_id, note, created_at) VALUES (2, 2, ?, ?)').run(c.bloodRecord, visited);
    bumpRevision(db);
  });
}
