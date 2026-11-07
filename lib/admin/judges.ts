import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/db/types.gen';
import type { JudgeRow } from '@/lib/domain/judges';

// SPEC §11 Judges (v0.12.4). Server-only reads and writes of the judges table, always scoped to the guarded event.
type Db = SupabaseClient<Database>;

export interface Judge { id: string; name: string; title: string | null; linkedinUrl: string | null; badgeUid: string | null }

export async function listJudges(db: Db, eventId: string): Promise<Judge[]> {
  const { data, error } = await db.from('judges').select('id, name, title, linkedin_url, badge_uid').eq('event_id', eventId).order('name');
  if (error) throw new Error(`judges list failed (${error.code})`);
  return data.map((j) => ({ id: j.id, name: j.name, title: j.title, linkedinUrl: j.linkedin_url, badgeUid: j.badge_uid }));
}

// Keyed by the name (case-insensitive): a judge already here gets the sheet's title, and its LinkedIn when the sheet has
// one (a LinkedIn typed on the page stays when the sheet's cell is blank). Nobody is deleted by an import.
export async function importJudges(db: Db, eventId: string, rows: JudgeRow[], dryRun: boolean) {
  const existing = new Map((await listJudges(db, eventId)).map((j) => [j.name.toLowerCase(), j]));
  let created = 0;
  let updated = 0;
  let unchanged = 0;
  for (const row of rows) {
    const had = existing.get(row.name.toLowerCase());
    if (!had) {
      created++;
      if (!dryRun) {
        const { error } = await db.from('judges').insert({ event_id: eventId, name: row.name, title: row.title, linkedin_url: row.linkedinUrl });
        if (error) throw new Error(`judge insert failed (${error.code})`);
      }
      continue;
    }
    const next = { title: row.title, linkedin_url: row.linkedinUrl ?? had.linkedinUrl };
    if (next.title === had.title && next.linkedin_url === had.linkedinUrl) {
      unchanged++;
      continue;
    }
    updated++;
    if (!dryRun) {
      const { error } = await db.from('judges').update(next).eq('id', had.id).eq('event_id', eventId);
      if (error) throw new Error(`judge update failed (${error.code})`);
    }
  }
  return { created, updated, unchanged };
}

export async function setJudgeLinkedin(db: Db, eventId: string, judgeId: string, linkedinUrl: string | null): Promise<boolean> {
  const { data, error } = await db.from('judges').update({ linkedin_url: linkedinUrl }).eq('id', judgeId).eq('event_id', eventId).select('id');
  if (error) throw new Error(`judge update failed (${error.code})`);
  return data.length > 0;
}

// LINKED (moved off another judge if it was theirs), BADGE_TAKEN (a hacker's badge in this event), NOT_FOUND.
// shortcut: a hacker's link_badge() doesn't check judges, so a judge's badge linked to a hacker later shows the hacker
// (badge_profile wins on the badge page); fine while judges get their own badges, else move it into link_badge().
export async function linkJudgeBadge(db: Db, eventId: string, judgeId: string, uid: string, now: Date) {
  const { data: hacker, error: e1 } = await db.from('badges').select('uid').eq('event_id', eventId).eq('uid', uid).maybeSingle();
  if (e1) throw new Error(`badge lookup failed (${e1.code})`);
  if (hacker) return 'BADGE_TAKEN' as const;
  const { data: judge, error: e2 } = await db.from('judges').select('id').eq('id', judgeId).eq('event_id', eventId).maybeSingle();
  if (e2) throw new Error(`judge lookup failed (${e2.code})`);
  if (!judge) return 'NOT_FOUND' as const;
  const { error: e3 } = await db.from('judges').update({ badge_uid: null, badge_linked_at: null }).eq('event_id', eventId).eq('badge_uid', uid).neq('id', judgeId);
  if (e3) throw new Error(`judge badge move failed (${e3.code})`);
  const { error: e4 } = await db.from('judges').update({ badge_uid: uid, badge_linked_at: now.toISOString() }).eq('id', judgeId).eq('event_id', eventId);
  if (e4) throw new Error(`judge badge link failed (${e4.code})`);
  return 'LINKED' as const;
}

export async function unlinkJudgeBadge(db: Db, eventId: string, judgeId: string): Promise<boolean> {
  const { data, error } = await db.from('judges').update({ badge_uid: null, badge_linked_at: null }).eq('id', judgeId).eq('event_id', eventId).not('badge_uid', 'is', null).select('id');
  if (error) throw new Error(`judge badge unlink failed (${error.code})`);
  return data.length > 0;
}

export async function deleteJudge(db: Db, eventId: string, judgeId: string): Promise<boolean> {
  const { data, error } = await db.from('judges').delete().eq('id', judgeId).eq('event_id', eventId).select('id');
  if (error) throw new Error(`judge delete failed (${error.code})`);
  return data.length > 0;
}

// The badge page (§6.5): a judge's badge, in an event that ended at most 30 days ago. Name, title and LinkedIn only.
export async function judgeForBadge(db: Db, uid: string, now: Date): Promise<{ name: string; title: string | null; linkedinUrl: string | null } | null> {
  const { data, error } = await db.from('judges').select('name, title, linkedin_url, event_id').eq('badge_uid', uid).order('badge_linked_at', { ascending: false });
  if (error) {
    // Never break the badge page over the judge lookup (e.g. this code live before its migration): show "not linked".
    console.error(JSON.stringify({ level: 'error', where: 'judgeForBadge', code: error.code }));
    return null;
  }
  const cutoff = now.getTime() - 30 * 24 * 3600 * 1000;
  for (const j of data) {
    const { data: event, error: e } = await db.from('events').select('ends_at').eq('id', j.event_id).maybeSingle();
    if (e) throw new Error(`event lookup failed (${e.code})`);
    if (event && new Date(event.ends_at).getTime() > cutoff) return { name: j.name, title: j.title, linkedinUrl: j.linkedin_url };
  }
  return null;
}

// A judge's own page (/judge/<id>, v0.12.4): the same card as their badge, with or without a badge linked, while their
// event ended at most 30 days ago. Organizers open it from the Judges tab.
export async function judgeById(db: Db, id: string, now: Date): Promise<{ name: string; title: string | null; linkedinUrl: string | null } | null> {
  const { data, error } = await db.from('judges').select('name, title, linkedin_url, events!inner(ends_at)').eq('id', id).maybeSingle();
  if (error) throw new Error(`judge lookup failed (${error.code})`);
  if (!data || new Date(data.events.ends_at).getTime() <= now.getTime() - 30 * 24 * 3600 * 1000) return null;
  return { name: data.name, title: data.title, linkedinUrl: data.linkedin_url };
}
