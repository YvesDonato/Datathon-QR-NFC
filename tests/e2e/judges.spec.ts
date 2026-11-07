import { expect, test } from '@playwright/test';
import { toCsv } from '@/lib/domain/csv';
import { authStatePath, E2E_ORIGIN, installFakeNfc, nfcActive, nfcTap, nfcWrites, saveSignedInState, serialOf } from '../fixtures/e2e';
import { createStandardFixture, randomUid, type StandardFixture } from '../fixtures/standard';

// SPEC §11 Judges (v0.12.4, owner's request). The e2e server runs with BADGE_ORIGIN=https://badges.example.test.
const ORG = authStatePath('judges-org');
test.describe.configure({ mode: 'serial' });
test.use({ storageState: ORG });

let f: StandardFixture;
test.beforeAll(async ({ browser }) => {
  f = await createStandardFixture();
  await saveSignedInState(browser, f.staffEmail.org1, ORG);
});
test.afterAll(async () => {
  await f.close();
});

test('T-JUDGE-04: import the tracker, fix a LinkedIn, link a judge’s badge; tapping it shows Judge, title and LinkedIn', async ({ page, browser }) => {
  await installFakeNfc(page);
  await page.goto(`/admin/${f.slug}`);
  await page.getByRole('navigation', { name: 'Admin' }).getByRole('link', { name: 'Judges', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Judges', level: 1 })).toBeVisible();
  await expect(page.getByText('No judges yet.')).toBeVisible();

  const csv = toCsv(['Name', 'Title @ Company', 'LinkedIn', 'Contact', 'Status', 'Notes'], [
    ['Ayush Singh', 'Research Scientist @ Meta', '', 'a@meta.com', 'Confirmed', 'vegetarian'],
    ['Mahir Azim', 'AI Product Manager @ EY', 'https://www.linkedin.com/in/mahirazim/', 'm@x.com', 'Confirmed', ''],
    ['Not Yet', 'X', '', '', 'Contacted', ''],
  ]);
  await page.getByLabel('CSV file').setInputFiles({ name: 'judges.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
  await expect(page.getByText('2 judges in the file: 2 new, 0 updated, 0 unchanged, 1 not confirmed (skipped).')).toBeVisible();
  await page.getByRole('button', { name: 'Import 2' }).click();
  await expect(page.getByRole('status').filter({ hasText: '✓ Imported: 2 new, 0 updated.' })).toBeVisible();
  const ayush = page.getByRole('row', { name: /Ayush Singh/ });
  await expect(ayush).toContainText('Research Scientist @ Meta');
  await expect(page.getByRole('row', { name: /Mahir Azim/ }).getByLabel('LinkedIn for Mahir Azim')).toHaveValue('https://www.linkedin.com/in/mahirazim');
  await expect(page.getByText('Not Yet')).toHaveCount(0);

  const linkedin = ayush.getByLabel('LinkedIn for Ayush Singh');
  await linkedin.fill('linkedin.com/company/meta');
  await ayush.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'That isn’t a LinkedIn profile link' })).toBeVisible();
  await linkedin.fill('linkedin.com/in/ayush-singh-se/');
  await ayush.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('status').filter({ hasText: '✓ LinkedIn saved for Ayush Singh.' })).toBeVisible();
  await expect(linkedin).toHaveValue('https://www.linkedin.com/in/ayush-singh-se');

  await ayush.getByRole('button', { name: 'Link badge for Ayush Singh' }).click();
  const dialog = page.getByRole('dialog', { name: 'Link a badge' });
  await expect(dialog).toContainText('Tap the badge to link it to Ayush Singh.');
  await expect.poll(() => nfcActive(page)).toBe(1);
  const uid = randomUid();
  await nfcTap(page, serialOf(uid));
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('status').filter({ hasText: `✓ Badge ${serialOf(uid)} linked to Ayush Singh. Its profile link is on the badge.` })).toBeVisible();
  await expect(ayush).toContainText('✓ Linked');
  await expect(ayush.getByRole('link', { name: 'Open Ayush Singh’s badge page' })).toHaveAttribute('href', `/profile/${uid}`);
  expect(await nfcWrites(page)).toEqual([{ records: [{ recordType: 'url', data: `https://badges.example.test/profile/${uid}?tap` }] }]);
  expect(await nfcActive(page)).toBe(0);

  // A hacker's badge can't become a judge's.
  const { uid: hackerUid } = await f.linkBadge(f.p.A);
  await page.getByRole('row', { name: /Mahir Azim/ }).getByRole('button', { name: 'Link badge for Mahir Azim' }).click();
  await expect.poll(() => nfcActive(page)).toBe(1);
  await nfcTap(page, serialOf(hackerUid), [`https://badges.example.test/profile/${hackerUid}?tap`]);
  await expect(page.getByRole('status').filter({ hasText: `✕ Badge ${serialOf(hackerUid)} is a hacker’s badge. Use another badge for Mahir Azim.` })).toBeVisible();

  // Anyone tapping the judge's badge: Judge, name, title, LinkedIn; no Connect, no email.
  const anon = await browser.newContext({ baseURL: E2E_ORIGIN, storageState: undefined });
  const tap = await anon.newPage();
  await tap.goto(`/profile/${uid}?tap`);
  await expect(tap.getByRole('heading', { name: 'Ayush Singh' })).toBeVisible();
  await expect(tap.getByText('Judge', { exact: true })).toBeVisible();
  await expect(tap.getByText('Research Scientist @ Meta')).toBeVisible();
  await expect(tap.getByRole('link', { name: /LinkedIn/ })).toHaveAttribute('href', 'https://www.linkedin.com/in/ayush-singh-se');
  await expect(tap.getByRole('button', { name: /Connect/ })).toHaveCount(0);
  expect(await tap.content()).not.toContain('a@meta.com');
  await anon.close();

  // Unlink: the badge stops opening the judge.
  await ayush.getByRole('button', { name: 'Unlink badge for Ayush Singh' }).click();
  await page.getByRole('dialog', { name: 'Unlink this badge?' }).getByRole('button', { name: 'Unlink badge' }).click();
  await expect(ayush).toContainText('No badge');
});
