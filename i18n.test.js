import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { TASK_STATUSES } from '../../shared/domain.js';

const root = new URL('../../', import.meta.url).pathname;
const LOCALES = ['sk', 'en', 'ru', 'ar', 'zh-CN'];
const dicts = Object.fromEntries(LOCALES.map((l) => [l, JSON.parse(readFileSync(join(root, `src/i18n/locales/${l}.json`), 'utf8'))]));

function flatten(obj, prefix = '') {
  return Object.entries(obj).flatMap(([k, v]) => (typeof v === 'string' ? [[prefix + k, v]] : flatten(v, `${prefix}${k}.`)));
}
const flat = Object.fromEntries(LOCALES.map((l) => [l, new Map(flatten(dicts[l]))]));

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]));
}
const sources = walk(join(root, 'src')).filter((f) => /\.tsx?$/.test(f)).map((f) => readFileSync(f, 'utf8'));
const serverSrc = readFileSync(join(root, 'server/app.js'), 'utf8') + readFileSync(join(root, 'shared/domain.js'), 'utf8');

test('all locales have exactly the same keys and no empty strings', () => {
  const ref = [...flat.en.keys()].sort();
  for (const l of LOCALES) {
    assert.deepEqual([...flat[l].keys()].sort(), ref, `keys differ in ${l}`);
    for (const [k, v] of flat[l]) assert.ok(v.trim(), `${l}:${k} is empty`);
  }
});

test('placeholders match the English source', () => {
  const ph = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');
  for (const l of LOCALES) for (const [k, v] of flat.en) assert.equal(ph(flat[l].get(k)), ph(v), `${l}:${k}`);
});

test('every static key used in the code exists', () => {
  const used = new Set();
  for (const src of sources) for (const m of src.matchAll(/\bt\(\s*['"]([a-zA-Z_]+\.[a-zA-Z_.]+)['"]/g)) used.add(m[1]);
  for (const src of sources) for (const m of src.matchAll(/key:\s*'([a-z]+\.[a-zA-Z_]+)'/g)) used.add(m[1]);
  assert.ok(used.size > 100, `only ${used.size} keys found`);
  for (const k of used) assert.ok(flat.en.has(k), `missing key ${k}`);
});

test('dynamic key families are complete', () => {
  const need = [
    ...TASK_STATUSES.map((s) => `status.${s}`),
    ...['created', 'edited', 'published', 'assigned', 'reassigned', 'accepted', 'declined', 'claimed', 'unassigned', 'completed', 'cancelled', 'record_added'].map((h) => `history.${h}`),
    ...['assigned', 'accepted', 'declined', 'claimed', 'completed', 'cancelled', 'unassigned', 'needs_helper', 'record_added', 'edited'].map((n) => `notif.${n}`),
    ...['board', 'mine', 'all'].map((x) => `board.tab_${x}`),
    'roles.coordinator', 'roles.helper', 'settings.block_work', 'settings.block_other',
  ];
  for (const k of need) assert.ok(flat.en.has(k), `missing ${k}`);
});

test('every server error code has a translation', () => {
  const codes = new Set();
  for (const m of serverSrc.matchAll(/HttpError\(\d+,\s*'([a-z_]+)'/g)) codes.add(m[1]);
  for (const m of serverSrc.matchAll(/return '([a-z_]+)'/g)) codes.add(m[1]);
  for (const m of serverSrc.matchAll(/HttpError\(\d+, [a-z =']*\? '([a-z_]+)' : '([a-z_]+)'/g)) { codes.add(m[1]); codes.add(m[2]); }
  assert.ok(codes.size > 20);
  for (const c of codes) assert.ok(flat.en.has(`errors.${c}`), `missing errors.${c}`);
});

test('no hard-coded Slovak UI text in components', () => {
  const slovak = /[ľščťžýáíéúäôňĺŕ]/i;
  for (const src of sources) {
    for (const m of src.matchAll(/>([^<>{}\n]+)</g)) {
      assert.ok(!slovak.test(m[1]), `hard-coded text: ${m[1]}`);
    }
  }
});
