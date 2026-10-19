import { createServer } from 'node:http';
import { openDb } from '../../server/db.js';
import { createApp } from '../../server/app.js';

export async function startServer() {
  const db = openDb(':memory:');
  const server = createServer(createApp({ db }));
  await new Promise((r) => server.listen(0, r));
  const base = `http://127.0.0.1:${server.address().port}`;
  return { db, base, close: () => new Promise((r) => server.close(r)) };
}

/** Minimal cookie-keeping client, one per simulated person/device. */
export function client(base) {
  let cookie = '';
  async function call(method, path, body, headers = {}) {
    const isBuf = body instanceof Buffer;
    const res = await fetch(base + path, {
      method,
      headers: {
        ...(body !== undefined && !isBuf ? { 'Content-Type': 'application/json' } : {}),
        ...(method !== 'GET' ? { 'X-Requested-With': 'care-app' } : {}),
        ...(cookie ? { Cookie: cookie } : {}),
        ...headers,
      },
      body: body === undefined ? undefined : isBuf ? body : JSON.stringify(body),
    });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    const type = res.headers.get('content-type') ?? '';
    const data = type.includes('json') ? await res.json() : await res.arrayBuffer();
    return { status: res.status, data };
  }
  return {
    call,
    get: (p) => call('GET', p),
    post: (p, b = {}, h) => call('POST', p, b, h),
    patch: (p, b) => call('PATCH', p, b),
    async login(username, password = 'demo1234') {
      const r = await call('POST', '/api/auth/login', { username, password });
      if (r.status !== 200) throw new Error(`login failed ${r.status}`);
      return r.data.user;
    },
  };
}

export const inHours = (h) => new Date(Date.now() + h * 3600_000).toISOString();
