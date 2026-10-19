import { test, expect, type Page } from '@playwright/test';
import { device, uid, dayFromNow, PNG, jsErrors } from './helpers';

const nav = (page: Page) => page.getByRole('navigation', { name: 'Hlavná navigácia' });
const H = { 'X-Requested-With': 'care-app' };

test('Flow A: S1 → S2 → S3 (cancel & save) → S4 → S5a → S6, calendar reflects it', async ({ browser }) => {
  const { page } = await device(browser, 'jana');
  const id = uid();
  const date = dayFromNow(3);

  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1, name: 'Mama · Prehľad' })).toBeVisible();
  await expect(page.getByText('Lieky dnes')).toBeVisible();
  await expect(page.getByText('Úlohy bez riešiteľa')).toBeVisible();

  // S1 → S2
  await nav(page).getByRole('link', { name: 'Kalendár' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Kalendár' })).toBeVisible();

  // S2 → S3, then cancel returns to S2 without creating anything
  await page.getByRole('button', { name: 'Udalosť' }).click();
  await expect(page.getByRole('heading', { name: 'Nová udalosť' })).toBeVisible();
  await page.getByLabel('Názov').fill(`Zrušená ${id}`);
  await page.getByRole('button', { name: 'Zrušiť' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Kalendár' })).toBeVisible();
  const st = await (await page.request.get('/api/state')).json();
  expect(st.state.events.some((e: { title: string }) => e.title === `Zrušená ${id}`)).toBe(false);

  // S3 validation + save
  await page.getByRole('button', { name: 'Udalosť' }).click();
  await page.getByRole('button', { name: 'Uložiť' }).click();
  await expect(page.getByText('Toto pole je povinné.').first()).toBeVisible();
  await page.getByLabel('Názov').fill(`Kontrola u kardiológa ${id}`);
  await page.getByLabel('Dátum').fill(date);
  await page.getByLabel('Čas').fill('09:00');
  await page.getByLabel('Miesto').fill('Nemocnica, amb. 12');
  await page.getByText('Treba odvoz / sprievod').click();
  await page.getByRole('button', { name: 'Uložiť' }).click();

  // S3 → S4 with defaults derived from the event
  await expect(page.getByRole('heading', { name: 'Nová úloha' })).toBeVisible();
  await expect(page.getByLabel('Úloha')).toHaveValue('Odvoz a sprievod – Mama');
  await expect(page.getByLabel('K udalosti').locator('option:checked')).toContainText(`Kontrola u kardiológa ${id}`);
  await expect(page.getByLabel('Termín')).toHaveValue(`${date}T08:15`);
  await page.getByLabel('Úloha').fill(`Odviezť mamu ${id}`);
  await page.getByRole('button', { name: 'Priradiť' }).click();

  // S5a
  await expect(page.getByRole('heading', { name: 'Komu priradiť?' })).toBeVisible();
  await expect(page.getByText('Dostupnosť podľa kalendára.')).toBeVisible();
  await page.getByRole('button', { name: 'Odoslať' }).click();
  await expect(page.getByText('Vyberte, kto má úlohu vykonať.')).toBeVisible();
  await page.getByRole('radio', { name: /Peter/ }).check({ force: true });
  await page.getByRole('button', { name: 'Odoslať' }).click();

  // S6
  await expect(page.getByRole('heading', { name: 'Detail úlohy' })).toBeVisible();
  await expect(page.getByText(`Odviezť mamu ${id}`)).toBeVisible();
  await expect(page.locator('.chip', { hasText: 'Čaká na potvrdenie' })).toBeVisible();
  await expect(page.getByRole('status').getByText('Úloha poslaná: Peter.')).toBeVisible();
  await expect(page.getByText('Čaká sa, kým Peter potvrdí.')).toBeVisible();

  // Calendar shows the new event and task deadline on that day
  await page.goto(`/calendar?d=${date}`);
  await expect(page.getByRole('link', { name: new RegExp(`Kontrola u kardiológa ${id}`) })).toBeVisible();
  await expect(page.getByRole('link', { name: new RegExp(`Odviezť mamu ${id}`) })).toBeVisible();

  // Refresh keeps data (server persistence)
  await page.reload();
  await expect(page.getByRole('link', { name: new RegExp(`Odviezť mamu ${id}`) })).toBeVisible();
  expect(jsErrors(page)).toEqual([]);
});

async function createAssigned(page: Page, title: string, assignee: number) {
  const due = new Date(Date.now() + 2 * 86400_000).toISOString();
  const r = await page.request.post('/api/tasks', { data: { title, due_at: due }, headers: H });
  const { id } = await r.json();
  const a = await page.request.post(`/api/tasks/${id}/actions`, { data: { action: 'assign', assignee_id: assignee }, headers: H });
  expect(a.ok()).toBe(true);
  return id as number;
}

test('Flow B accept + Flow D visit record: S6 → S7 → S8 → S11 → S8', async ({ browser }) => {
  const jana = await device(browser, 'jana');
  const peter = await device(browser, 'peter');
  const title = `Odviezť mamu ${uid()}`;
  const id = await createAssigned(jana.page, title, 2);

  // S7: Peter's notification with Accept / Decline
  await peter.page.goto('/');
  await peter.page.getByRole('link', { name: /Upozornenia/ }).click();
  const card = peter.page.locator('.notif', { hasText: title });
  await expect(card.getByText('Jana vás žiada o úlohu')).toBeVisible();
  await expect(card.getByRole('button', { name: 'Odmietnuť' })).toBeVisible();
  await card.getByRole('button', { name: 'Prijať' }).click();

  // S8
  await expect(peter.page).toHaveURL(new RegExp(`/tasks/${id}$`));
  await expect(peter.page.locator('.chip', { hasText: 'Potvrdené' })).toBeVisible();
  await expect(peter.page.getByText('Rieši: Peter')).toBeVisible();
  await expect(peter.page.locator('.panel').first().getByText(/Peter potvrdil\(a\) /)).toBeVisible();

  // Jana sees the change and a notification (on her own device)
  await jana.page.goto(`/tasks/${id}`);
  await expect(jana.page.locator('.chip', { hasText: 'Potvrdené' })).toBeVisible();
  await jana.page.goto('/notifications');
  await expect(jana.page.locator('.notif', { hasText: title }).getByText('Peter prijal(a) úlohu')).toBeVisible();

  // S8 → S11
  await peter.page.getByRole('button', { name: 'Pridať záznam' }).click();
  await expect(peter.page.getByRole('heading', { name: 'Nový záznam' })).toBeVisible();
  await expect(peter.page.getByText(`K úlohe: ${title}`)).toBeVisible();

  // Validation: note required, wrong file type rejected
  await peter.page.getByRole('button', { name: 'Uložiť' }).click();
  await expect(peter.page.getByText('Toto pole je povinné.')).toBeVisible();
  await peter.page.locator('#photo-input').setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('hello') });
  await expect(peter.page.getByText('Povolené sú len fotky JPG, PNG alebo WebP.')).toBeVisible();

  // Failed upload: record must NOT be saved
  await peter.page.getByLabel('Ako prebehla návšteva?').fill('Lekár je spokojný, kontrola o 3 mesiace.');
  await peter.page.locator('#photo-input').setInputFiles({ name: 'sprava.png', mimeType: 'image/png', buffer: PNG });
  await expect(peter.page.getByAltText('Vybraná fotka')).toBeVisible();
  await peter.page.route('**/api/photos', (route) => route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"server_error"}' }));
  await peter.page.getByRole('button', { name: 'Uložiť' }).click();
  await expect(peter.page.getByText(/Fotku sa nepodarilo nahrať a záznam nebol uložený/)).toBeVisible();
  await expect(peter.page.getByRole('heading', { name: 'Nový záznam' })).toBeVisible();
  let st = await (await peter.page.request.get('/api/state')).json();
  expect(st.state.records.filter((r: { task_id: number }) => r.task_id === id)).toHaveLength(0);

  // Successful upload + save → back to S8 with the record
  await peter.page.unroute('**/api/photos');
  await peter.page.getByRole('button', { name: 'Uložiť' }).click();
  await expect(peter.page).toHaveURL(new RegExp(`/tasks/${id}$`));
  await expect(peter.page.getByRole('status').getByText('Záznam uložený.')).toBeVisible();
  await expect(peter.page.getByText('Lekár je spokojný, kontrola o 3 mesiace.')).toBeVisible();
  const img = peter.page.locator('.record-photo').first();
  await expect(img).toBeVisible();
  expect(await img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0)).toBe(true);
  st = await (await peter.page.request.get('/api/state')).json();
  expect(st.state.records.filter((r: { task_id: number; photo_id: number | null }) => r.task_id === id && r.photo_id)).toHaveLength(1);

  // Accepting did not complete it; completing is explicit.
  await expect(peter.page.locator('.chip', { hasText: 'Potvrdené' })).toBeVisible();
  await peter.page.getByRole('button', { name: 'Označiť ako hotové' }).click();
  await expect(peter.page.locator('.chip', { hasText: 'Hotovo' })).toBeVisible();

  // Records tab lists it
  await peter.page.goto('/records');
  await expect(peter.page.getByText('Lekár je spokojný, kontrola o 3 mesiace.')).toBeVisible();
  expect(jsErrors(peter.page)).toEqual([]);
});

test('Flow B decline: S7 → S9 → S10 → S5a reassign keeps history', async ({ browser }) => {
  const jana = await device(browser, 'jana');
  const peter = await device(browser, 'peter');
  const eva = await device(browser, 'eva');
  const title = `Odviezť mamu ${uid()}`;
  const id = await createAssigned(jana.page, title, 2);

  await peter.page.goto('/notifications');
  await peter.page.locator('.notif', { hasText: title }).getByRole('button', { name: 'Odmietnuť' }).click();
  // S9
  await expect(peter.page.getByRole('heading', { name: 'Odmietnuť úlohu' })).toBeVisible();
  await expect(peter.page.getByText('Jana dostane správu.')).toBeVisible();
  await peter.page.getByLabel('Dôvod (nepovinné)').fill('som v práci');
  await peter.page.getByRole('button', { name: 'Odoslať' }).click();
  await expect(peter.page.locator('.chip', { hasText: 'Odmietnuté' })).toBeVisible();

  // S10 on Jana's device
  await jana.page.goto('/notifications');
  const n = jana.page.locator('.notif', { hasText: title });
  await expect(n.getByText('Peter odmietol(a) úlohu')).toBeVisible();
  await expect(n.getByText('„som v práci“')).toBeVisible();
  await n.getByRole('link', { name: new RegExp(title) }).click();
  await expect(jana.page.locator('.chip', { hasText: 'Odmietnuté' })).toBeVisible();
  await expect(jana.page.getByText('Peter odmietol(a):')).toBeVisible();
  await expect(jana.page.locator('.decline-box').getByText('„som v práci“')).toBeVisible();

  // S10 → S5a
  await jana.page.getByRole('button', { name: 'Priradiť znova' }).click();
  await expect(jana.page.getByRole('heading', { name: 'Komu priradiť?' })).toBeVisible();
  await expect(jana.page.getByRole('radio', { name: /Peter/ })).toBeVisible();
  await expect(jana.page.locator('.radio-card', { hasText: 'Peter' }).getByText('túto úlohu už odmietol(a)')).toBeVisible();
  await jana.page.getByRole('radio', { name: /Eva/ }).check({ force: true });
  await jana.page.getByRole('button', { name: 'Odoslať' }).click();
  await expect(jana.page.locator('.chip', { hasText: 'Čaká na potvrdenie' })).toBeVisible();

  const timeline = jana.page.locator('.timeline');
  await expect(timeline.getByText('Jana priradil(a) úlohu: Peter')).toBeVisible();
  await expect(timeline.getByText('Peter odmietol(a)', { exact: true })).toBeVisible();
  await expect(timeline.getByText('„som v práci“')).toBeVisible();
  await expect(timeline.getByText('Jana priradil(a) úlohu znova: Eva')).toBeVisible();

  // Peter can no longer accept; Eva can.
  await peter.page.goto('/notifications');
  await expect(peter.page.locator('.notif', { hasText: title }).getByRole('button', { name: 'Prijať' })).toHaveCount(0);
  await eva.page.goto('/notifications');
  await eva.page.locator('.notif', { hasText: title }).first().getByRole('button', { name: 'Prijať' }).click();
  await expect(eva.page.getByText('Rieši: Eva')).toBeVisible();
});

test('Flow C: S4 → board (S5b) → "Beriem to"; a second claim is refused', async ({ browser }) => {
  const jana = await device(browser, 'jana');
  const eva = await device(browser, 'eva');
  const peter = await device(browser, 'peter');
  const title = `Nákup liekov ${uid()}`;

  // Publish to the board from S4
  await jana.page.goto('/tasks/new');
  await jana.page.getByLabel('Úloha').fill(title);
  await jana.page.getByLabel('Termín').fill(`${dayFromNow(1)}T17:00`);
  await jana.page.getByRole('button', { name: 'Zverejniť na nástenke' }).click();
  await expect(jana.page.getByRole('heading', { level: 1, name: 'Nástenka úloh' })).toBeVisible();
  await expect(jana.page.locator('.task-card', { hasText: title })).toBeVisible();
  await expect(jana.page.locator('main').getByText('Všetci dostanú notifikáciu.')).toBeVisible();

  // Both helpers open the board
  await eva.page.goto('/tasks');
  await peter.page.goto('/tasks');
  const evaCard = eva.page.locator('.task-card', { hasText: title });
  await expect(evaCard).toContainText(/o \d+ hodín|zajtra|o \d+ hodiny|o \d+ hodinu/);
  await evaCard.getByRole('button', { name: 'Beriem to' }).click();
  await expect(eva.page.getByText('Rieši: Eva')).toBeVisible();
  await expect(eva.page.locator('.chip', { hasText: 'Potvrdené' })).toBeVisible();

  // Peter's page is stale: his claim must fail and the card disappears
  await peter.page.locator('.task-card', { hasText: title }).getByRole('button', { name: 'Beriem to' }).click();
  await expect(peter.page.getByRole('status').getByText('Túto úlohu si práve vzal niekto iný.')).toBeVisible();
  await expect(peter.page.locator('.task-card', { hasText: title })).toHaveCount(0);

  // Removed from the unassigned list on the overview
  await jana.page.goto('/');
  await expect(jana.page.getByText(title)).toHaveCount(0);
});

test('language choice persists across reloads', async ({ browser }) => {
  const { page } = await device(browser, 'jana');
  await page.goto('/settings');
  await page.locator('main').getByLabel('Jazyk').selectOption('en');
  await expect(page.getByRole('heading', { level: 1, name: 'Settings' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { level: 1, name: 'Settings' })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('care.locale'))).toBe('en');
});

test('sign-in form: wrong password shows an error, demo sign-in works', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  await page.addInitScript(() => localStorage.setItem('care.locale', 'sk'));
  await page.goto('/');
  await page.getByLabel('Používateľské meno').fill('jana');
  await page.getByLabel('Heslo').fill('zle-heslo');
  await page.getByRole('button', { name: 'Prihlásiť sa' }).click();
  await expect(page.getByText('Nesprávne meno alebo heslo.')).toBeVisible();
  await page.getByRole('button', { name: 'Peter' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Mama · Prehľad' })).toBeVisible();
});
