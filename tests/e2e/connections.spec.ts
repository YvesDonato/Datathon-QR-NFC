import { expect, test } from '@playwright/test';
import { E2E_ORIGIN, signIn } from '../fixtures/e2e';
import { createAccount, createStandardFixture, type StandardFixture } from '../fixtures/standard';

// SPEC F17 (v0.12): Connect on a badge page; it counts once both have tapped; /me links Connections.
let f: StandardFixture;
test.describe.configure({ mode: 'serial' });
test.beforeAll(async () => {
  f = await createStandardFixture();
});
test.afterAll(async () => {
  await f.close();
});

const emailOf = async (participantId: string) =>
  (await f.pool.query<{ email: string }>('select email from participants where id = $1', [participantId])).rows[0]?.email ?? '';

test('T-CONN-06: A connects on B’s badge, B connects back, both see each other on /me; signed out sees no connect at all; fellow attendees see the bio (v0.12.4)', async ({ browser }) => {
  await f.checkIn(f.p.A);
  await f.checkIn(f.p.B);
  const { uid: aBadge } = await f.linkBadge(f.p.A);
  const { uid: bBadge } = await f.linkBadge(f.p.B);
  await f.pool.query(`update participants set linkedin_url = 'https://www.linkedin.com/in/ben-fixture', profile_public = true where id = $1`, [f.p.B]);
  // v0.12.4: his directory bio shows on his badge page, but only to fellow attendees (the directory's audience, F16).
  await f.pool.query(`update participants set bio = $2, directory_opt_in = true where id = $1`, [f.p.B, 'I build <b>quokkabots</b>\nand drink tea']);

  const anon = await browser.newContext({ baseURL: E2E_ORIGIN });
  const anonPage = await anon.newPage();
  await anonPage.goto(`/profile/${bBadge}?tap`);
  await expect(anonPage.getByText('Ben')).not.toHaveCount(0); // the profile itself is shown
  await expect(anonPage.getByRole('link', { name: /Sign in/ })).toHaveCount(0); // owner's request: no Sign in to connect
  await expect(anonPage.getByRole('button', { name: /Connect/ })).toHaveCount(0);
  await expect(anonPage.getByTestId('badge-bio')).toHaveCount(0); // never to strangers
  expect(await anonPage.content()).not.toContain('quokkabots');
  await anon.close();

  const a = await browser.newContext({ baseURL: E2E_ORIGIN });
  const aPage = await a.newPage();
  await createAccount(await emailOf(f.p.A));
  await signIn(aPage, await emailOf(f.p.A), `/profile/${bBadge}?tap`);
  await expect(aPage.getByTestId('badge-bio')).toHaveText('I build <b>quokkabots</b>\nand drink tea', { useInnerText: true }); // escaped, line kept
  await f.pool.query(`update participants set profile_public = false where id = $1`, [f.p.B]);
  await aPage.reload();
  await expect(aPage.getByTestId('badge-bio')).toHaveCount(0); // a private badge stays nameless and bio-less
  await f.pool.query(`update participants set profile_public = true, directory_opt_in = false where id = $1`, [f.p.B]);
  await aPage.reload();
  await expect(aPage.getByRole('heading', { name: 'Ben Fixture' })).toBeVisible();
  await expect(aPage.getByTestId('badge-bio')).toHaveCount(0); // not listed in the directory: no bio
  await aPage.getByRole('button', { name: 'Connect with Ben' }).click();
  await expect(aPage.getByText('Sent! It counts once Ben taps your badge too.')).toBeVisible();
  await expect(aPage.getByRole('button', { name: /Connect/ })).toHaveCount(0);

  const b = await browser.newContext({ baseURL: E2E_ORIGIN });
  const bPage = await b.newPage();
  await createAccount(await emailOf(f.p.B));
  await signIn(bPage, await emailOf(f.p.B), `/profile/${aBadge}?tap`);
  await expect(bPage.getByText('Ada tapped your badge. Connect back to make it count.')).toBeVisible();
  await bPage.getByRole('button', { name: 'Connect back with Ada' }).click();
  await expect(bPage.getByText('✓ You’re connected with Ada.')).toBeVisible();

  // A's menu: the Connections row counts it; the page lists Ben with his shared LinkedIn.
  await aPage.goto('/me');
  const row = aPage.getByRole('navigation', { name: 'Hacker menu' }).getByRole('link', { name: /^Connections/ });
  await expect(row).toContainText('1 connection · #1 on the leaderboard');
  await row.click();
  await expect(aPage.getByRole('heading', { name: 'Connections', level: 1 })).toBeVisible();
  await expect(aPage.getByText('1 connection', { exact: true })).toBeVisible();
  await expect(aPage.getByRole('link', { name: 'Ben Fixture', exact: true })).toHaveAttribute('href', `/profile/${bBadge}`);
  await expect(aPage.getByRole('link', { name: 'LinkedIn: Ben Fixture' })).toHaveAttribute('href', 'https://www.linkedin.com/in/ben-fixture');
  await a.close();
  await b.close();
});
