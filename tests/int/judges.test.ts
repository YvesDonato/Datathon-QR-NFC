import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { judgeForBadge } from '@/lib/admin/judges';
import { toCsv } from '@/lib/domain/csv';
import { adminClient } from '../fixtures/admin-api';
import { serviceClient } from '../fixtures/mail';
import { signInAs } from '../fixtures/staff';
import { createStandardFixture, randomUid, type StandardFixture } from '../fixtures/standard';

// SPEC §11 Judges (v0.12.4, owner's request): import, LinkedIn, badges, and the badge page's judge lookup.
let f: StandardFixture;
let org: string;
const admin = adminClient();
beforeAll(async () => {
  f = await createStandardFixture();
  org = await signInAs(f.staffEmail.org1);
});
afterAll(async () => {
  await f.close();
});

const tracker = (rows: string[][]) => toCsv(['Name', 'Title @ Company', 'LinkedIn', 'Contact', 'Status', 'Notes'], rows);
const call = (name: Parameters<typeof admin.call>[0], jwt: string | null, params: Record<string, string>, init?: { method?: string; body?: unknown }) =>
  admin.call(name, jwt, { slug: f.slug, ...params }, init);
const judges = async () => (await call('listJudges', org, {})).body as { judges: Array<{ id: string; name: string; title: string | null; linkedinUrl: string | null; badgeUid: string | null }> };

describe('judges (SPEC §11, v0.12.4)', () => {
  it('T-JUDGE-02: organizers only; import previews then applies, keyed by name, never deleting; LinkedIn typed on the page survives a blank cell', async () => {
    const vol = await signInAs(f.staffEmail.vol1);
    const csv = tracker([
      ['Wael Ramadan', 'Professor @ Sheridan', 'https://www.linkedin.com/in/wael-r', 'w@sheridan.ca', 'Confirmed', 'halal'],
      ['Ayush Singh', 'Research Scientist @ Meta', '', 'a@meta.com', 'Confirmed', ''],
      ['Maybe Later', 'X', '', '', 'Contacted', ''],
    ]);
    expect((await call('listJudges', vol, {})).status).toBe(403);
    expect((await call('listJudges', null, {})).status).toBe(401);
    expect((await call('importJudges', vol, {}, { body: { csv, dryRun: true } })).status).toBe(403);
    expect((await call('importJudges', org, {}, { body: { csv, dryRun: true, extra: 1 } })).status).toBe(400);
    expect((await call('importJudges', org, {}, { body: { csv: 'Who\nA\n', dryRun: true } })).status).toBe(422);

    expect((await call('importJudges', org, {}, { body: { csv, dryRun: true } })).body).toEqual({ created: 2, updated: 0, unchanged: 0, total: 2, skipped: 1, badLinkedin: 0 });
    expect((await judges()).judges).toEqual([]); // the dry run wrote nothing
    expect((await call('importJudges', org, {}, { body: { csv, dryRun: false } })).body).toMatchObject({ created: 2 });
    const [ayush, wael] = (await judges()).judges;
    expect(ayush).toMatchObject({ name: 'Ayush Singh', title: 'Research Scientist @ Meta', linkedinUrl: null, badgeUid: null });
    expect(wael).toMatchObject({ name: 'Wael Ramadan', linkedinUrl: 'https://www.linkedin.com/in/wael-r' });

    // LinkedIn on the page: normalized, refused when not a profile, cleared when blank; 404 for another event's judge.
    expect((await call('updateJudge', org, { id: ayush!.id }, { method: 'PATCH', body: { linkedin: 'linkedin.com/in/ayush-singh-se/' } })).body).toEqual({ linkedinUrl: 'https://www.linkedin.com/in/ayush-singh-se' });
    expect((await call('updateJudge', org, { id: ayush!.id }, { method: 'PATCH', body: { linkedin: 'https://linkedin.com/company/meta' } })).status).toBe(400);
    expect((await call('updateJudge', org, { id: crypto.randomUUID() }, { method: 'PATCH', body: { linkedin: '' } })).status).toBe(404);

    // Re-import: Ayush's blank cell keeps the typed LinkedIn; a new title updates; nobody is deleted.
    const again = tracker([['ayush singh', 'Staff Research Scientist @ Meta', '', '', 'Confirmed', '']]);
    expect((await call('importJudges', org, {}, { body: { csv: again, dryRun: false } })).body).toMatchObject({ created: 0, updated: 1, unchanged: 0 });
    const after = (await judges()).judges;
    expect(after).toHaveLength(2);
    expect(after[0]).toMatchObject({ name: 'Ayush Singh', title: 'Staff Research Scientist @ Meta', linkedinUrl: 'https://www.linkedin.com/in/ayush-singh-se' });

    // Audit rows carry counts and ids only (I-11).
    const audit = await f.pool.query<{ action: string; detail: unknown }>(`select action, detail from audit_log where event_id = $1 and action like 'judge.%' order by id`, [f.e1.id]);
    expect(audit.rows.map((r) => r.action)).toEqual(['judge.import', 'judge.update', 'judge.import']);
    expect(JSON.stringify(audit.rows)).not.toMatch(/Ayush|Wael|linkedin|meta/i);
  });

  it('T-JUDGE-03: a badge links to one judge (moving off another), never a hacker’s badge; unlink; the badge page finds the judge', async () => {
    const [ayush, wael] = (await judges()).judges;
    const uid = randomUid();
    expect((await call('linkJudgeBadge', org, { id: ayush!.id }, { body: { uid: uid.toUpperCase() } })).status).toBe(400); // normalized only
    expect((await call('linkJudgeBadge', org, { id: ayush!.id }, { body: { uid } })).body).toEqual({ code: 'LINKED' });
    expect(await judgeForBadge(serviceClient(), uid, new Date())).toEqual({ name: 'Ayush Singh', title: 'Staff Research Scientist @ Meta', linkedinUrl: 'https://www.linkedin.com/in/ayush-singh-se' });
    expect((await call('linkJudgeBadge', org, { id: wael!.id }, { body: { uid } })).body).toEqual({ code: 'LINKED' }); // moved
    expect((await judges()).judges.map((j) => j.badgeUid)).toEqual([null, uid]);

    const { uid: hackerUid } = await f.linkBadge(f.p.A);
    expect((await call('linkJudgeBadge', org, { id: ayush!.id }, { body: { uid: hackerUid } })).body).toEqual({ code: 'BADGE_TAKEN' });

    // 30 days after the event, the judge's badge stops opening their profile, like a hacker's.
    const { rows: [ev] } = await f.pool.query<{ ends_at: Date }>('select ends_at from events where id = $1', [f.e1.id]);
    const later = new Date(ev!.ends_at.getTime() + 31 * 24 * 3600 * 1000);
    expect(await judgeForBadge(serviceClient(), uid, later)).toBeNull();

    expect((await call('unlinkJudgeBadge', org, { id: wael!.id }, { method: 'DELETE' })).body).toEqual({ code: 'UNLINKED' });
    expect((await call('unlinkJudgeBadge', org, { id: wael!.id }, { method: 'DELETE' })).status).toBe(404);
    expect(await judgeForBadge(serviceClient(), uid, new Date())).toBeNull();
    expect((await call('deleteJudge', org, { id: wael!.id }, { method: 'DELETE' })).body).toEqual({ deleted: true });
    expect((await judges()).judges.map((j) => j.name)).toEqual(['Ayush Singh']);
  });
});
