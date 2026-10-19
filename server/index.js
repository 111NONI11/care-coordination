import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { openDb } from './db.js';
import { createApp } from './app.js';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const port = Number(process.env.PORT ?? 3001);
const dbPath = process.env.DB_PATH ?? resolve(root, 'data/care.db');
const dist = resolve(root, 'dist');

const db = openDb(dbPath);
const handler = createApp({
  db,
  staticDir: existsSync(dist) && process.env.NODE_ENV === 'production' ? dist : undefined,
  demo: process.env.DEMO !== '0',
  secureCookies: process.env.COOKIE_SECURE === '1',
  loginLimit: Number(process.env.LOGIN_RATE_LIMIT ?? 20),
  trustProxy: process.env.TRUST_PROXY === '1',
});

createServer(handler).listen(port, () => {
  console.log(`Care coordination API listening on http://localhost:${port} (db: ${dbPath})`);
});
