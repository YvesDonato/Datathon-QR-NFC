import { expect, test, type Page } from '@playwright/test';
import {
  authStatePath,
  chooseCheckpoint,
  fakeCameraArgs,
  forceGc,
  installFakeNfc,
  liveCameraTracks,
  nfcActive,
  nfcTap,
  nfcUnreadable,
  nfcWrites,
  saveSignedInState,
  serialOf,
  trackCameraStreams,
  warmDevServer,
} from '../fixtures/e2e';
import { createStandardFixture, randomUid, type StandardFixture } from '../fixtures/standard';

// SPEC §10.5 / §14.15: badge scanning in the scanner, with a fake Web NFC reader (CLAUDE.md mock list).
const AUTH = authStatePath('scanner-nfc');
test.describe.configure({ mode: 'serial' });
test.use({ launchOptions: { args: [...fakeCameraArgs(), '--js-flags=--expose-gc'] }, permissions: ['camera'], storageState: AUTH });

let f: StandardFixture;
test.beforeAll(async ({ browser }) => {
  f = await createStandardFixture();
  await saveSignedInState(browser, f.staffEmail.vol1, AUTH);
  await warmDevServer(f.slug);
});
test.afterAll(async () => {
  await f.close();
});

async function openScanner(page: Page, checkpoint = 'Door') {
  await page.goto(`/scan/${f.slug}`);
  await chooseCheckpoint(page, checkpoint);
  await expect(page.locator('main')).toHaveAttribute('data-camera', 'ready');
}

// v0.8.1: badges are their own input mode; the camera is off while the reader is on.
async function readerOn(page: Page) {
  await page.getByRole('button', { name: 'NFC badges' }).click();
  await expect(page.getByRole('button', { name: 'NFC badges' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByText('Ready: tap a badge on the back of the phone')).toBeVisible();
}

async function manualDoorScan(page: Page, query: string, name: string) {
  await page.getByRole('button', { name: 'Manual search' }).click();
  await page.getByPlaceholder('Type a name').fill(query);
  await page.getByRole('button', { name: `Record scan for ${name}` }).click();
  const result = page.getByTestId('scan-result');
  await expect(result).toContainText('ADMIT');
  await expect(result).toBeHidden({ timeout: 4000 });
}

test('T-NFC-10: without Web NFC there are no badge controls at all', async ({ page }) => {
  await openScanner(page);
  await expect(page.getByRole('button', { name: /badge/i })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Camera', exact: true })).toHaveCount(0); // no input switch either
});

test('T-NFC-10: a linked badge scans through the real API; repeats, unreadable tags and offline taps send nothing', async ({ page, context }) => {
  await installFakeNfc(page);
  const { uid } = await f.linkBadge(f.p.A);
  const bodies: string[] = [];
  page.on('request', (r) => {
    if (r.url().endsWith('/api/scan')) bodies.push(r.postData() ?? '');
  });
  await openScanner(page);
  await readerOn(page);

  const result = page.getByTestId('scan-result');
  await nfcTap(page, serialOf(uid));
  await expect(result).toHaveAttribute('data-tone', 'green');
  await expect(result).toContainText('ADMIT');
  await nfcTap(page, serialOf(uid)); // same badge again while the result is up
  await expect(result).toBeHidden({ timeout: 4000 });
  expect(bodies).toHaveLength(1);
  expect(JSON.parse(bodies[0] ?? '{}')).toMatchObject({ method: 'nfc', badgeUid: uid });

  await nfcTap(page, ''); // a tag that reports no UID
  await expect(result).toContainText('Not a Datathon code');
  await expect(result).toBeHidden({ timeout: 3000 });

  await context.setOffline(true);
  await expect(page.getByText('OFFLINE: use paper list')).toBeVisible();
  await nfcTap(page, serialOf(randomUid()));
  await expect(result).toBeHidden();
  await context.setOffline(false);
  expect(bodies).toHaveLength(1);
});

test('T-NFC-29: Manual search links a badge without scanning; a repeated tap is ignored until the dedupe window ends', async ({ page }) => {
  await installFakeNfc(page);
  await openScanner(page);
  await readerOn(page);
  const uid = randomUid();
  const scans: string[] = [];
  page.on('request', (r) => {
    if (r.url().endsWith('/api/scan')) scans.push(r.postData() ?? '');
  });
  await page.getByRole('button', { name: 'Manual search' }).click();
  await page.getByPlaceholder('Type a name').fill('ben');
  await page.getByRole('button', { name: 'Link badge for Ben Fixture', exact: true }).click();
  const sheet = page.getByRole('dialog', { name: 'Link a badge' });
  await expect(sheet).toContainText('Tap the badge to link it to Ben Fixture.');
  expect(await nfcActive(page)).toBe(1);
  const tappedAt = new Date();
  await page.clock.setFixedTime(tappedAt);
  const linked = page.waitForResponse(`**/api/events/${f.slug}/badges`);
  await nfcTap(page, serialOf(uid));
  expect((await linked).request().postDataJSON()).toEqual({ participantId: f.p.B, uid });
  await expect(sheet).toContainText(`✓ Badge ${serialOf(uid)} linked to Ben Fixture.`);
  expect(await nfcWrites(page)).toEqual([{ records: [{ recordType: 'url', data: `https://badges.example.test/profile/${uid}?tap` }] }]);
  await expect(sheet).toContainText('Its profile link is on the badge.');
  const badge = await f.pool.query<{ participant_id: string }>('select participant_id from badges where event_id = $1 and uid = $2', [f.e1.id, uid]);
  expect(badge.rows).toEqual([{ participant_id: f.p.B }]);
  const benScans = async () => (await f.pool.query('select id from scans where participant_id = $1', [f.p.B])).rows;
  expect(await benScans()).toEqual([]);
  await expect(page.getByTestId('scan-result')).toBeHidden();
  await nfcTap(page, serialOf(randomUid())); // the result stays in the sheet; another badge is not linked
  await expect(sheet).toContainText(`✓ Badge ${serialOf(uid)} linked to Ben Fixture.`);
  await sheet.getByRole('button', { name: 'Done' }).click();
  await nfcTap(page, serialOf(uid));
  await page.waitForTimeout(300); // allow an accidental scan request to reach the server
  expect(scans).toEqual([]);
  expect(await benScans()).toEqual([]);
  await expect(page.getByTestId('scan-result')).toBeHidden();
  expect(await nfcActive(page)).toBe(1);
  await expect(page.getByRole('button', { name: 'NFC badges' })).toHaveAttribute('aria-pressed', 'true');

  await page.clock.setFixedTime(new Date(tappedAt.getTime() + 3001));
  await nfcTap(page, serialOf(uid));
  await expect(page.getByTestId('scan-result')).toContainText('ADMIT');
  await expect(page.getByTestId('scan-result')).toHaveAttribute('data-tone', 'green');
  expect(scans).toHaveLength(1);
  expect(await benScans()).toHaveLength(1);
  await page.getByTestId('scan-result').click();
  await page.getByRole('button', { name: 'Manual search' }).click();
  await page.getByPlaceholder('Type a name').fill('ben');
  await expect(page.getByTestId('search-row')).toContainText('Badge linked');
  await expect(page.getByRole('button', { name: 'Replace badge for Ben Fixture' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Record scan for Ben Fixture' })).toBeVisible();
});

// v0.11.40 tests use their own accepted hackers: this file's fixture is shared, and later tests expect Ben and Nia unlinked.
async function freshHacker(first: string) {
  const { id } = await f.addParticipant(f.e1.id);
  await f.pool.query(`update participants set first_name = $2, search_text = lower($2) || ' fixture' where id = $1`, [id, first]);
  return { id, name: `${first} Fixture`, query: first.toLowerCase() };
}

test('T-NFC-29: a door ADMIT offers Link badge; one tap links it without a second scan, and an untouched ADMIT still closes (v0.11.40)', async ({ page }) => {
  await installFakeNfc(page);
  const [lina, pia] = [await freshHacker('Lina'), await freshHacker('Pia')];
  await openScanner(page);
  const uid = randomUid();
  const linaScans = async () => (await f.pool.query('select id from scans where participant_id = $1', [lina.id])).rows;
  await page.getByRole('button', { name: 'Manual search' }).click();
  await page.getByPlaceholder('Type a name').fill(lina.query);
  await page.getByRole('button', { name: `Record scan for ${lina.name}` }).click();
  const result = page.getByTestId('scan-result');
  await expect(result).toContainText('ADMIT');
  if (process.env.HOVER_SCREENSHOTS) { await page.waitForTimeout(600); await page.screenshot({ path: `${process.env.HOVER_SCREENSHOTS}/admit-link.png` }); } // after the fade-in
  await result.getByRole('button', { name: 'Link badge' }).click();
  const sheet = page.getByRole('dialog', { name: 'Link a badge' });
  await expect(sheet).toContainText(`Tap the badge to link it to ${lina.name}.`);
  await expect(result).toBeHidden();
  const linked = page.waitForResponse(`**/api/events/${f.slug}/badges`);
  await nfcTap(page, serialOf(uid));
  expect((await linked).request().postDataJSON()).toEqual({ participantId: lina.id, uid });
  await expect(sheet).toContainText(`✓ Badge ${serialOf(uid)} linked to ${lina.name}.`);
  expect(await linaScans()).toHaveLength(1); // the check-in only; the linking tap is never a scan
  await sheet.getByRole('button', { name: 'Done' }).click();
  await expect(page.locator('main')).toHaveAttribute('data-camera', 'ready'); // Camera mode is back

  await manualDoorScan(page, pia.query, pia.name); // not touched: closes by itself as before
});

test('T-NFC-29: the Link badge button opens a link-only search; Replace badge moves them to a new badge (v0.11.40)', async ({ page }) => {
  await installFakeNfc(page);
  const omar = await freshHacker('Omar');
  await openScanner(page);
  const [first, second] = [randomUid(), randomUid()];
  const scans: string[] = [];
  page.on('request', (r) => {
    if (r.url().endsWith('/api/scan')) scans.push(r.postData() ?? '');
  });
  const linkOne = async (action: 'Link' | 'Replace', uid: string) => {
    await page.getByRole('button', { name: 'Link badge', exact: true }).click();
    const search = page.getByRole('region', { name: 'Link a badge' });
    await expect(search).toContainText('Find the hacker, then tap Link badge or Replace badge.');
    await search.getByPlaceholder('Type a name').fill(omar.query);
    await expect(search.getByRole('button', { name: `${action} badge for ${omar.name}` })).toBeVisible();
    await expect(search.getByRole('button', { name: /Record scan/ })).toHaveCount(0);
    if (action === 'Replace' && process.env.HOVER_SCREENSHOTS) await page.screenshot({ path: `${process.env.HOVER_SCREENSHOTS}/link-only-search.png` });
    await search.getByRole('button', { name: `${action} badge for ${omar.name}` }).click();
    const sheet = page.getByRole('dialog', { name: 'Link a badge' });
    await nfcTap(page, serialOf(uid));
    await expect(sheet).toContainText(`✓ Badge ${serialOf(uid)} linked to ${omar.name}.`);
    await sheet.getByRole('button', { name: 'Done' }).click();
  };
  await linkOne('Link', first);
  await linkOne('Replace', second);
  const badges = await f.pool.query<{ uid: string }>('select uid from badges where event_id = $1 and participant_id = $2', [f.e1.id, omar.id]);
  expect(badges.rows).toEqual([{ uid: second }]); // the old badge no longer opens or scans anyone
  expect(scans).toEqual([]);
});

test('T-NFC-29: without Web NFC a door ADMIT offers no Link badge (v0.11.40)', async ({ page }) => {
  const quin = await freshHacker('Quin');
  await openScanner(page);
  await page.getByRole('button', { name: 'Manual search' }).click();
  await page.getByPlaceholder('Type a name').fill(quin.query);
  await page.getByRole('button', { name: `Record scan for ${quin.name}` }).click();
  const result = page.getByTestId('scan-result');
  await expect(result).toContainText('ADMIT');
  await expect(result.getByRole('button', { name: 'Link badge' })).toHaveCount(0);
});

test('T-NFC-29: a taken badge shows a red notice in the link sheet and never a scan result', async ({ page }) => {
  await installFakeNfc(page);
  await page.route('**/api/events/*/badges', (route) => route.fulfill({ json: { code: 'BADGE_TAKEN' } }));
  await openScanner(page);
  await readerOn(page);
  await page.getByRole('button', { name: 'Manual search' }).click();
  await page.getByPlaceholder('Type a name').fill('nia');
  await page.getByRole('button', { name: 'Link badge for Nia Fixture', exact: true }).click();
  const uid = randomUid();
  await nfcTap(page, serialOf(uid));
  const sheet = page.getByRole('dialog', { name: 'Link a badge' });
  const notice = sheet.getByText(`✕ Badge ${serialOf(uid)} is linked to someone else. Ask an organizer to move it.`);
  await expect(notice).toBeVisible();
  await expect(notice).toHaveAttribute('data-tone', 'bad');
  await expect(notice).toHaveCSS('color', 'rgb(248, 113, 113)');
  await expect(page.getByTestId('scan-result')).toBeHidden();
  await expect(sheet.getByRole('button', { name: 'Done' })).toBeVisible();
});

test('T-NFC-29: linking temporarily releases the camera and reuses one reader; Cancel restores Camera mode', async ({ page }) => {
  await installFakeNfc(page);
  await trackCameraStreams(page);
  await openScanner(page);
  expect(await liveCameraTracks(page)).toBe(1);
  expect(await nfcActive(page)).toBe(0);
  await page.getByRole('button', { name: 'Manual search' }).click();
  await page.getByPlaceholder('Type a name').fill('nia');
  await page.getByRole('button', { name: 'Link badge for Nia Fixture', exact: true }).click();
  const sheet = page.getByRole('dialog', { name: 'Link a badge' });
  await expect(sheet).toBeVisible();
  await expect.poll(() => liveCameraTracks(page)).toBe(0);
  await expect.poll(() => nfcActive(page)).toBe(1);
  await expect(page.locator('main')).toHaveAttribute('data-scanning', 'paused');
  await sheet.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.locator('main')).toHaveAttribute('data-camera', 'ready');
  expect(await liveCameraTracks(page)).toBe(1);
  expect(await nfcActive(page)).toBe(0);
  await expect(page.getByRole('button', { name: 'Camera', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.reload();
  await expect(page.getByRole('button', { name: 'Camera', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('main')).toHaveAttribute('data-camera', 'ready');
});

test('T-NFC-29: unreadable tags keep waiting and repeated taps during a link send only one request', async ({ page }) => {
  await installFakeNfc(page);
  let release: () => void = () => undefined;
  const answer = new Promise<void>((r) => (release = r));
  const links: string[] = [];
  const scans: string[] = [];
  page.on('request', (r) => {
    if (r.url().endsWith('/api/scan')) scans.push(r.url());
  });
  await page.route('**/api/events/*/badges', async (route) => {
    links.push(route.request().postData() ?? '');
    await answer;
    await route.fulfill({ json: { code: 'NOT_FOUND' } });
  });
  await openScanner(page);
  await readerOn(page);
  await page.getByRole('button', { name: 'Manual search' }).click();
  await page.getByPlaceholder('Type a name').fill('nia');
  await page.getByRole('button', { name: 'Link badge for Nia Fixture', exact: true }).click();
  const sheet = page.getByRole('dialog', { name: 'Link a badge' });
  await nfcUnreadable(page);
  await expect(sheet).toContainText('Couldn’t read that badge. Hold it still and tap again.');
  await nfcTap(page, '');
  await expect(sheet).toContainText('Couldn’t read that badge. Hold it still and tap again.');
  expect(links).toEqual([]);
  await expect(sheet.getByRole('button', { name: 'Cancel' })).toBeVisible();
  await nfcTap(page, serialOf(randomUid()));
  await expect.poll(() => links.length).toBe(1);
  await nfcTap(page, serialOf(randomUid()));
  await nfcUnreadable(page);
  release();
  await expect(sheet).toContainText('✕ Nia Fixture isn’t in this event any more.');
  expect(links).toHaveLength(1);
  expect(scans).toEqual([]);
  await expect(page.getByTestId('scan-result')).toBeHidden();
});

test('T-NFC-29: a failed link request stays in the sheet without a scan result', async ({ page }) => {
  await installFakeNfc(page);
  await page.route('**/api/events/*/badges', (route) => route.abort('failed'));
  await openScanner(page);
  await readerOn(page);
  await page.getByRole('button', { name: 'Manual search' }).click();
  await page.getByPlaceholder('Type a name').fill('nia');
  await page.getByRole('button', { name: 'Link badge for Nia Fixture', exact: true }).click();
  await nfcTap(page, serialOf(randomUid()));
  const sheet = page.getByRole('dialog', { name: 'Link a badge' });
  await expect(sheet).toContainText('✕ Badge not linked. Try again.');
  await expect(sheet.getByRole('button', { name: 'Done' })).toBeVisible();
  await expect(page.getByTestId('scan-result')).toBeHidden();
});

test('T-NFC-29: another badge tapped while a link is saving is not scanned by a repeated report after Done', async ({ page }) => {
  await installFakeNfc(page);
  const { id } = await f.addParticipant(f.e1.id);
  const { uid: other } = await f.linkBadge(id); // a working badge: a stray scan of it would be ACCEPTED
  let release: () => void = () => undefined;
  const answer = new Promise<void>((r) => (release = r));
  const scans: string[] = [];
  page.on('request', (r) => {
    if (r.url().endsWith('/api/scan')) scans.push(r.url());
  });
  await page.route('**/api/events/*/badges', async (route) => {
    await answer;
    await route.fulfill({ json: { code: 'LINKED' } });
  });
  await openScanner(page);
  await readerOn(page);
  await page.getByRole('button', { name: 'Manual search' }).click();
  await page.getByPlaceholder('Type a name').fill('nia');
  await page.getByRole('button', { name: 'Link badge for Nia Fixture', exact: true }).click();
  const sheet = page.getByRole('dialog', { name: 'Link a badge' });
  await nfcTap(page, serialOf(randomUid()));
  await expect(sheet).toContainText('Linking badge…');
  await nfcTap(page, serialOf(other)); // ignored while saving
  release();
  await sheet.getByRole('button', { name: 'Done' }).click();
  await nfcTap(page, serialOf(other)); // Android reporting that tap again, within 3 s
  await expect(sheet).toBeHidden();
  await page.waitForTimeout(300); // a scan would be sent at once
  expect(scans).toEqual([]);
  await expect(page.getByTestId('scan-result')).toBeHidden();
});

test('T-NFC-29: closing the link sheet while the link is saving resumes scanning and still reports the outcome', async ({ page }) => {
  await installFakeNfc(page);
  let release: () => void = () => undefined;
  const answer = new Promise<void>((r) => (release = r));
  await page.route('**/api/events/*/badges', async (route) => {
    await answer;
    await route.fulfill({ json: { code: 'LINKED' } });
  });
  await openScanner(page);
  await readerOn(page);
  await page.getByRole('button', { name: 'Manual search' }).click();
  await page.getByPlaceholder('Type a name').fill('nia');
  await page.getByRole('button', { name: 'Link badge for Nia Fixture', exact: true }).click();
  const sheet = page.getByRole('dialog', { name: 'Link a badge' });
  const uid = randomUid();
  await nfcTap(page, serialOf(uid));
  await expect(sheet).toContainText('Linking badge…');
  // Chrome closes a <dialog> on a second Back/Escape even if the page refuses the first: never strand the scanner.
  await page.keyboard.press('Escape');
  await expect(sheet).toBeHidden();
  await expect(page.locator('main')).toHaveAttribute('data-scanning', 'on');
  release();
  await expect(page.getByRole('status')).toContainText(`✓ Badge ${serialOf(uid)} linked to Nia Fixture.`);
  // A later link opens a fresh sheet.
  await page.getByRole('button', { name: 'Manual search' }).click();
  await page.getByPlaceholder('Type a name').fill('nia');
  await page.getByRole('button', { name: /badge for Nia Fixture/ }).click();
  await expect(sheet).toBeVisible();
  await expect(sheet).toContainText('Tap the badge to link it to Nia Fixture.');
  await expect(sheet).not.toContainText('Linking badge…');
  const next = randomUid();
  await nfcTap(page, serialOf(next));
  await expect(sheet).toContainText(`✓ Badge ${serialOf(next)} linked to Nia Fixture.`);
});

test('T-NFC-29: waitlisted participants have no Link badge action', async ({ page }) => {
  await installFakeNfc(page);
  await openScanner(page);
  await page.getByRole('button', { name: 'Manual search' }).click();
  await page.getByPlaceholder('Type a name').fill('cy');
  const row = page.getByTestId('search-row');
  await expect(row).toContainText('Cy Fixture');
  await expect(row).toContainText('waitlisted');
  await expect(row.getByRole('button', { name: /(?:Link|Replace) badge/ })).toHaveCount(0);
  await expect(row.getByRole('button', { name: 'Record scan for Cy Fixture' })).toBeVisible();
});

test('T-NFC-29: Manual search has no Link badge action without Web NFC', async ({ page }) => {
  await openScanner(page);
  await page.getByRole('button', { name: 'Manual search' }).click();
  await page.getByPlaceholder('Type a name').fill('nia');
  const row = page.getByTestId('search-row');
  await expect(row).toContainText('Nia Fixture');
  await expect(row.getByRole('button', { name: /(?:Link|Replace) badge/ })).toHaveCount(0);
  await expect(row.getByRole('button', { name: 'Record scan for Nia Fixture' })).toBeVisible();
});

test('T-NFC-29: the undo ticker does not refetch Manual search or remount its buttons', async ({ page }) => {
  await installFakeNfc(page);
  await openScanner(page);
  await readerOn(page);
  await manualDoorScan(page, 'nia', 'Nia Fixture');
  await expect(page.getByRole('button', { name: 'Undo last' })).toBeVisible();
  const searches: string[] = [];
  page.on('request', (r) => {
    if (r.url().includes('/participants/search?')) searches.push(r.url());
  });
  await page.getByRole('button', { name: 'Manual search' }).click();
  await page.getByPlaceholder('Type a name').fill('nia');
  const link = page.getByRole('button', { name: 'Link badge for Nia Fixture', exact: true });
  await expect(link).toBeVisible();
  await link.focus();
  await page.waitForTimeout(2200); // two undo ticks must leave the search row and its focus alone
  expect(searches).toHaveLength(1);
  await expect(link).toBeFocused();
});

test('T-NFC-10: a badge read vibrates at once, before the answer; until the page is tapped, the scanner says to tap once', async ({ page }) => {
  await installFakeNfc(page);
  await page.addInitScript(() => {
    const w = window as unknown as { __vibrations: unknown[] };
    w.__vibrations = [];
    // Playwright's own locator checks count as user activation, so fake Chrome's sticky activation: only a click sets it.
    let tapped = false;
    for (const e of ['click', 'keydown']) window.addEventListener(e, () => (tapped = true), true);
    Object.defineProperty(navigator, 'userActivation', { value: { get hasBeenActive() { return tapped; }, get isActive() { return tapped; } } });
    Object.defineProperty(navigator, 'vibrate', {
      value: (pattern: unknown) => {
        w.__vibrations.push(pattern);
        return true;
      },
    });
  });
  const vibrations = () => page.evaluate(() => (window as unknown as { __vibrations: unknown[] }).__vibrations);
  const { uid } = await f.linkBadge(f.p.A);
  let release: () => void = () => undefined;
  const answer = new Promise<void>((r) => (release = r));
  await page.route('**/api/scan', async (route) => {
    await answer; // hold the server's answer back
    await route.continue();
  });

  await page.goto(`/scan/${f.slug}`);
  const hint = page.getByText('Tap the screen once so the phone can vibrate on each scan.');
  await expect(hint).toBeVisible();
  await page.keyboard.press('Shift'); // an activation that changes nothing else: only the activation listener can hide it
  await expect(hint).toBeHidden();
  await chooseCheckpoint(page, 'Raffle');
  await expect(page.locator('main')).toHaveAttribute('data-camera', 'ready');
  await readerOn(page);

  await nfcTap(page, serialOf(uid));
  await expect.poll(vibrations).toEqual([[30, 60, 30]]);
  const result = page.getByTestId('scan-result');
  await expect(result).toBeHidden(); // the tick came before any answer
  release();
  await expect(result).toHaveAttribute('data-tone', 'green');
  expect(await vibrations()).toEqual([[30, 60, 30], [60]]);

  // An unreadable tag while the green result is up is ignored (no amber over green); once it's gone, amber + notice.
  await nfcUnreadable(page);
  expect(await vibrations()).toEqual([[30, 60, 30], [60]]);
  await expect(page.getByText('Couldn’t read that badge')).toHaveCount(0);
  await expect(result).toBeHidden({ timeout: 4000 });
  await nfcUnreadable(page);
  await expect(page.getByText('Couldn’t read that badge. Hold it still and try again.')).toBeVisible();
  expect(await vibrations()).toEqual([[30, 60, 30], [60], [80, 80, 80]]);
});

test('T-NFC-10: taps still arrive after a garbage collection (a collected reader swallowed every tap on a real phone)', async ({ page }) => {
  await installFakeNfc(page);
  const { uid } = await f.linkBadge(f.p.B);
  await openScanner(page, 'Raffle');
  await readerOn(page);
  expect(await page.evaluate(() => typeof (window as unknown as { gc?: unknown }).gc)).toBe('function');
  await forceGc(page);
  await nfcTap(page, serialOf(uid));
  await expect(page.getByTestId('scan-result')).toHaveAttribute('data-tone', 'green');
});

test('T-NFC-23: NFC badges mode turns the camera off and keeps the reader on; the choice survives a reload; Camera brings the camera back', async ({ page }) => {
  await installFakeNfc(page);
  await trackCameraStreams(page);
  const { uid } = await f.linkBadge(f.p.N);
  const scans: string[] = [];
  page.on('request', (r) => {
    if (r.url().endsWith('/api/scan')) scans.push(r.url());
  });
  await openScanner(page, 'Raffle');
  await expect(page.getByRole('button', { name: 'Camera', exact: true })).toHaveAttribute('aria-pressed', 'true');

  await readerOn(page);
  await expect(page.locator('main')).toHaveAttribute('data-camera', 'off');
  expect(await page.evaluate(() => (document.querySelector('video') as HTMLVideoElement).srcObject)).toBeNull();
  expect(await liveCameraTracks(page)).toBe(0); // the camera itself is off, not just hidden
  expect(await nfcActive(page)).toBe(1);
  await expect(page.getByRole('button', { name: /Badge reader/ })).toHaveCount(0); // always on: no off switch

  // Reload: still in badge mode, camera off. Chrome needs a tap to start NFC unless permission was granted.
  await page.reload();
  await expect(page.getByRole('button', { name: 'NFC badges' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('main')).toHaveAttribute('data-camera', 'off');
  await page.getByRole('button', { name: 'Start badge reader' }).click();
  await expect(page.getByText('Ready: tap a badge on the back of the phone')).toBeVisible();
  await nfcTap(page, serialOf(uid));
  await expect(page.getByTestId('scan-result')).toHaveAttribute('data-tone', 'green');
  await expect(page.getByTestId('scan-result')).toBeHidden({ timeout: 4000 });

  // Back to the camera: it starts again, the reader stops, and a badge tap (a fresh one, so the dedupe can't
  // hide a request) sends nothing.
  await page.getByRole('button', { name: 'Camera', exact: true }).click();
  await expect(page.locator('main')).toHaveAttribute('data-camera', 'ready');
  expect(await nfcActive(page)).toBe(0);
  const before = scans.length;
  await nfcTap(page, serialOf(randomUid()));
  await page.waitForTimeout(1000);
  expect(scans.length).toBe(before);
  await expect(page.getByTestId('scan-result')).toBeHidden();
  await page.reload();
  await expect(page.getByRole('button', { name: 'Camera', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('main')).toHaveAttribute('data-camera', 'ready');
});

test('T-NFC-23: switching to NFC badges while the camera is still starting leaves it off', async ({ page }) => {
  await installFakeNfc(page);
  await trackCameraStreams(page, 1500); // a slow camera start (as with a permission prompt)
  await page.goto(`/scan/${f.slug}`);
  await chooseCheckpoint(page, 'Raffle');
  await expect(page.locator('main')).toHaveAttribute('data-camera', 'starting');
  await page.getByRole('button', { name: 'NFC badges' }).click();
  await page.waitForTimeout(2500); // past the slow start
  expect(await page.evaluate(() => (window as unknown as { __streams: MediaStream[] }).__streams.length)).toBe(1); // it did open
  expect(await liveCameraTracks(page)).toBe(0); // ...and was released at once
  await expect(page.locator('main')).toHaveAttribute('data-camera', 'off');
});

test('T-NFC-23: with the NFC permission already granted, NFC mode starts the reader by itself after a reload, exactly once', async ({ page }) => {
  await installFakeNfc(page);
  await page.addInitScript(() => {
    const query = navigator.permissions.query.bind(navigator.permissions);
    navigator.permissions.query = (d) => ((d as { name: string }).name === 'nfc' ? Promise.resolve({ state: 'granted' } as PermissionStatus) : query(d));
  });
  await openScanner(page, 'Raffle');
  await readerOn(page);
  expect(await nfcActive(page)).toBe(1); // the tap's reader, not replaced by an auto-start
  await page.reload();
  await expect(page.getByText('Ready: tap a badge on the back of the phone')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Start badge reader' })).toHaveCount(0);
  expect(await nfcActive(page)).toBe(1);
});

for (const mode of ['existing', 'failed'] as const) {
  test(`T-NFC-29: Manual search links with a ${mode} profile write and restores the camera`, async ({ page }) => {
    await installFakeNfc(page);
    await trackCameraStreams(page);
    if (mode === 'failed') await page.addInitScript(() => {
      (window as unknown as { NDEFReader: { prototype: { write: () => Promise<void> } } }).NDEFReader.prototype.write = async () => { throw new Error('read only'); };
    });
    await openScanner(page);
    await page.getByRole('button', { name: 'Manual search' }).click();
    await page.getByPlaceholder('Type a name').fill('nia');
    await page.getByRole('button', { name: /^(Link|Replace) badge for Nia Fixture$/ }).click();
    const uid = randomUid();
    await nfcTap(page, serialOf(uid), mode === 'existing' ? [`https://badges.example.test/profile/${uid}?tap`] : []);
    const sheet = page.getByRole('dialog', { name: 'Link a badge' });
    const suffix = mode === 'existing' ? '' : " Couldn't write its profile link: hold the badge still and tap Link badge again.";
    await expect(sheet).toContainText(`✓ Badge ${serialOf(uid)} linked to Nia Fixture.${suffix}`);
    expect(await nfcWrites(page)).toEqual([]);
    expect((await f.pool.query('select participant_id from badges where uid = $1', [uid])).rows).toEqual([{ participant_id: f.p.N }]);
    await expect(page.getByTestId('scan-result')).toBeHidden();
    await sheet.getByRole('button', { name: 'Done' }).click();
    await expect(page.locator('main')).toHaveAttribute('data-camera', 'ready');
    expect(await liveCameraTracks(page)).toBe(1);
    expect(await nfcActive(page)).toBe(0);
  });
}

for (const cancel of ['different tag', 'close', 'timeout'] as const) {
  test(`T-NFC-29: a pending profile write is aborted on ${cancel} and still links only the original badge`, async ({ page }) => {
    await installFakeNfc(page, 'pending');
    await openScanner(page);
    await readerOn(page);
    const scans: string[] = [];
    page.on('request', (r) => {
      if (r.url().endsWith('/api/scan')) scans.push(r.url());
    });
    await page.getByRole('button', { name: 'Manual search' }).click();
    await page.getByPlaceholder('Type a name').fill('nia');
    await page.getByRole('button', { name: /^(Link|Replace) badge for Nia Fixture$/ }).click();
    const uid = randomUid();
    const other = randomUid();
    await nfcTap(page, serialOf(uid));
    await expect.poll(() => nfcWrites(page)).toHaveLength(1);
    const sheet = page.getByRole('dialog', { name: 'Link a badge' });
    await expect(sheet).toContainText('Linking badge…');
    if (cancel === 'different tag') await nfcTap(page, serialOf(other));
    if (cancel === 'close') await sheet.getByRole('button', { name: 'Cancel', exact: true }).click();
    const notice = cancel === 'close' ? page.getByRole('status') : sheet;
    await expect(notice).toContainText(`✓ Badge ${serialOf(uid)} linked to Nia Fixture. Couldn't write its profile link: hold the badge still and tap Link badge again.`, { timeout: 10000 });
    expect(await page.evaluate(() => (window as unknown as { __nfcWriteAborted: boolean }).__nfcWriteAborted)).toBe(true);
    expect(await nfcWrites(page)).toEqual([{ records: [{ recordType: 'url', data: `https://badges.example.test/profile/${uid}?tap` }] }]);
    expect((await f.pool.query('select participant_id from badges where uid = $1', [uid])).rows).toEqual([{ participant_id: f.p.N }]);
    expect((await f.pool.query('select participant_id from badges where uid = $1', [other])).rows).toEqual([]);
    expect(scans).toEqual([]);
    await expect(page.getByTestId('scan-result')).toBeHidden();
  });
}
