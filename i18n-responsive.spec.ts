import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { device, jsErrors } from './helpers';

const LOCALES = ['sk', 'en', 'ru', 'ar', 'zh-CN'] as const;
const dict = (l: string) => JSON.parse(readFileSync(new URL(`../../src/i18n/locales/${l}.json`, import.meta.url), 'utf8'));
const SCREENS = ['/', '/calendar', '/events/new', '/events/1', '/tasks/new?event=1', '/tasks/1/assign', '/tasks', '/tasks/2', '/notifications', '/records', '/settings'];
const RAW_KEY = /\b(app|nav|common|overview|calendar|event|task|assign|board|decline|records|notif|history|toast|settings|errors|status|roles|login)\.[a-zA-Z_]+/;

for (const locale of LOCALES) {
  test(`all screens render in ${locale} without untranslated keys`, async ({ browser }) => {
    const d = dict(locale);
    const { page } = await device(browser, 'jana', { locale });
    for (const path of SCREENS) {
      await page.goto(path);
      await expect(page.locator('html')).toHaveAttribute('lang', locale);
      await expect(page.locator('html')).toHaveAttribute('dir', locale === 'ar' ? 'rtl' : 'ltr');
      await expect(page.locator('h1').first()).toBeVisible();
      const text = await page.locator('body').innerText();
      expect(text, `${locale} ${path}`).not.toMatch(RAW_KEY);
    }
    await page.goto('/');
    const navEl = page.getByRole('navigation', { name: d.nav.main });
    for (const k of ['overview', 'calendar', 'tasks', 'records']) await expect(navEl.getByRole('link', { name: d.nav[k] })).toBeVisible();
    await page.goto('/tasks/1');
    await expect(page.locator('.chip').first()).toHaveText(d.status.unassigned);
    expect(jsErrors(page)).toEqual([]);
  });
}

test('Arabic is a genuine RTL layout on phone and desktop', async ({ browser }) => {
  const phone = await device(browser, 'jana', { locale: 'ar', width: 390 });
  await phone.page.goto('/tasks/1/assign');
  const back = await phone.page.getByRole('button', { name: 'رجوع' }).boundingBox();
  expect(back!.x).toBeGreaterThan(390 / 2); // back button sits on the right
  const transform = await phone.page.locator('.icon-dir').first().evaluate((el) => getComputedStyle(el).transform);
  expect(transform).toContain('matrix(-1'); // chevron mirrored
  const radio = await phone.page.locator('.radio-card').first().locator('.radio-dot').boundingBox();
  expect(radio!.x).toBeGreaterThan(390 / 2); // radio on the start (right) side
  await phone.page.goto('/tasks');
  const card = phone.page.locator('.task-card').first();
  const cardBox = await card.boundingBox();
  const claim = await card.getByRole('button').boundingBox();
  expect(claim!.x).toBeLessThan(cardBox!.x + cardBox!.width / 2); // action button at the end (left)
  await phone.page.goto('/events/new');
  const input = await phone.page.getByLabel('الاسم').evaluate((el) => getComputedStyle(el).direction);
  expect(input).toBe('rtl');

  const desk = await device(browser, 'jana', { locale: 'ar', width: 1280 });
  await desk.page.goto('/');
  const sidebar = await desk.page.locator('.sidebar').boundingBox();
  expect(sidebar!.x).toBeGreaterThan(1280 / 2); // sidebar on the right
});

const WIDTHS = [360, 390, 768, 1024, 1280, 1440];
for (const width of WIDTHS) {
  test(`layout at ${width}px: no horizontal scroll, correct navigation`, async ({ browser }) => {
    for (const locale of ['sk', 'ar'] as const) {
      const { page, ctx } = await device(browser, 'jana', { locale, width });
      for (const path of SCREENS) {
        await page.goto(path);
        await expect(page.locator('h1').first()).toBeVisible();
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        expect(overflow, `${locale} ${path} @${width}`).toBeLessThanOrEqual(0);
      }
      await page.goto('/calendar');
      const desktop = width >= 1024;
      await expect(page.locator('.bottom-nav')).toBeVisible({ visible: !desktop });
      await expect(page.locator('.sidebar')).toBeVisible({ visible: desktop });
      // Primary action reachable without scrolling
      const cta = await page.locator('.action-bar .btn-primary').boundingBox();
      expect(cta!.y + cta!.height).toBeLessThanOrEqual(844);
      // Touch targets of the bottom navigation are at least 44px high
      if (!desktop) {
        const item = await page.locator('.bottom-nav .nav-item').first().boundingBox();
        expect(item!.height).toBeGreaterThanOrEqual(44);
      }
      await page.screenshot({ path: `test-results/screens/${locale}-${width}-calendar.png` });
      await page.goto('/');
      await page.screenshot({ path: `test-results/screens/${locale}-${width}-overview.png`, fullPage: true });
      await ctx.close();
    }
  });
}
