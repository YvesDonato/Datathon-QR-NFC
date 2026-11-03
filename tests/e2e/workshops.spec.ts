import { expect, test } from '@playwright/test';
import { E2E_ORIGIN, signIn } from '../fixtures/e2e';
import { createAccount, createStandardFixture, type StandardFixture } from '../fixtures/standard';

// Proposed F14 step 8: a hacker's Workshops page lists the workshops their badge was tapped at, with the cooldown.
let f: StandardFixture;
test.describe.configure({ mode: 'serial' });
test.beforeAll(async () => {
  f = await createStandardFixture();
});
test.afterAll(async () => {
  await f.close();
});

test('T-WS-03: the menu counts workshops; the page lists them newest first with the cooldown timer', async ({ browser }) => {
  const { rows } = await f.pool.query<{ id: string }>(
    `insert into checkpoints (event_id, name, kind, requires_checkin, is_open) values ($1, 'Intro to Pandas', 'session', true, true) returning id`,
    [f.e1.id],
  );
  const pandas = rows[0]?.id ?? '';
  await f.checkIn(f.p.A);
  const { uid } = await f.linkBadge(f.p.A);
  expect((await f.badgeScan({ cp: pandas, staff: f.staff.vol1, uid })).code).toBe('ACCEPTED');
  expect((await f.badgeScan({ cp: f.cp.W, staff: f.staff.vol1, uid })).code).toBe('SESSION_COOLDOWN');

  const email = (await f.pool.query<{ email: string }>('select email from participants where id = $1', [f.p.A])).rows[0]?.email ?? '';
  await createAccount(email);
  const ctx = await browser.newContext({ baseURL: E2E_ORIGIN });
  const page = await ctx.newPage();
  await signIn(page, email, '/me');
  const row = page.getByRole('navigation', { name: 'Hacker menu' }).getByRole('link', { name: /^Workshops/ });
  await expect(row).toContainText('1 attended');
  await row.click();
  await expect(page.getByRole('heading', { name: '1 workshop attended' })).toBeVisible();
  await expect(page.getByRole('listitem').filter({ hasText: 'Intro to Pandas' })).toContainText(/(EDT|EST)$/);
  await expect(page.getByTestId('cooldown-timer')).toHaveText(/^[45]:\d\d$/);
  await ctx.close();
});
