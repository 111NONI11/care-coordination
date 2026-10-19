import type { Browser, BrowserContext, Page } from '@playwright/test';

export const BASE = 'http://localhost:4300';
// 1×1 PNG
export const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8cfc0f01f0005000201f0b1d1a40000000049454e44ae426082', 'hex');

/** Opens a signed-in browser context (one "device") for a demo user. */
export async function device(browser: Browser, user: string, opts: { locale?: string; width?: number } = {}): Promise<{ ctx: BrowserContext; page: Page }> {
  const ctx = await browser.newContext({ baseURL: BASE, viewport: { width: opts.width ?? 390, height: 844 } });
  await ctx.addInitScript((l) => {
    if (!localStorage.getItem('care.locale')) localStorage.setItem('care.locale', l);
  }, opts.locale ?? 'sk');
  const r = await ctx.request.post('/api/auth/login', { data: { username: user, password: 'demo1234' }, headers: { 'X-Requested-With': 'care-app' } });
  if (!r.ok()) throw new Error(`login ${user} failed: ${r.status()}`);
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  (page as Page & { jsErrors: string[] }).jsErrors = errors;
  return { ctx, page };
}

export const jsErrors = (page: Page) => (page as Page & { jsErrors: string[] }).jsErrors;

export function uid() {
  return Math.random().toString(36).slice(2, 7);
}

/** Local date (YYYY-MM-DD) n days from now. */
export function dayFromNow(n: number) {
  const d = new Date();
  d.setDate(d.getDate() + n);
  const p = (x: number) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
