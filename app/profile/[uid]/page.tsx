import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { connection } from 'next/server';
import { z } from 'zod';
import { currentUser } from '@/lib/auth/session';
import { db } from '@/lib/db/server';
import { normalizeUid } from '@/lib/domain/badge';
import { normalizeEmail } from '@/lib/domain/normalize';
import { claimBadge, myBadgeProfiles } from '@/lib/me/profile';
import formStyles from '../../login/login.module.css';
import styles from './profile.module.css';

// SPEC §6.5: what a phone opens when it taps a badge. Only for a signed-in attendee or staff member
// of the badge's event (proxy.ts sends everyone else to /login first); badge_profile() decides and
// returns only opted-in fields. An unlinked badge is claimed here by its holder (v0.5).
// `?tap` (on tags written by the earlier datathon-badges app) is ignored.
export const metadata: Metadata = {
  title: 'Badge · Passline',
  referrer: 'no-referrer',
  robots: { index: false, follow: false },
};

const profileSchema = z
  .union([
    z.object({ allowed: z.literal(false) }),
    z.object({ allowed: z.literal(true), public: z.literal(false) }),
    z.object({
      allowed: z.literal(true),
      public: z.literal(true),
      firstName: z.string(),
      lastName: z.string(),
      linkedinUrl: z.string().nullable(),
    }),
  ])
  .nullable();

// v0.5 "This is my badge": the signed-in attendee links an unlinked badge to themselves (claim_badge()).
async function claim(formData: FormData) {
  'use server';
  const uid = normalizeUid(String(formData.get('uid') ?? ''));
  if (!uid) notFound();
  const user = await currentUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(`/profile/${uid}`)}`);
  const code = await claimBadge(db(), user, uid, String(formData.get('eventId') ?? ''));
  redirect(code === 'LINKED' ? '/me/profile?badge=linked' : `/profile/${uid}?claim=${code === 'BADGE_TAKEN' ? 'taken' : 'refused'}`);
}

export default async function BadgeProfilePage(props: {
  params: Promise<{ uid: string }>;
  searchParams: Promise<{ claim?: string }>;
}) {
  await connection(); // per request: an opt-out must take effect on the next view
  const raw = (await props.params).uid;
  const { claim: claimResult } = await props.searchParams;
  const uid = normalizeUid(raw);
  if (!uid) notFound();
  const viewer = await currentUser();
  if (!viewer) redirect(`/login?next=${encodeURIComponent(`/profile/${raw}`)}`);

  const { data, error } = await db().rpc('badge_profile', {
    p_uid: uid,
    p_viewer_id: viewer.id,
    p_viewer_email: normalizeEmail(viewer.email ?? ''),
  });
  if (error) throw new Error(`badge_profile failed (${error.code})`);
  // v0.6 (F14): the holder tapping their own badge opens their hacker menu.
  if (z.object({ self: z.literal(true) }).safeParse(data).success) redirect('/me');
  const profile = profileSchema.parse(data);
  // Events this person may claim the badge in (accepted, up to 30 days after the event).
  const claimable = profile === null ? await myBadgeProfiles(db(), viewer.email ?? '', new Date()) : [];

  return (
    <main className={styles.page}>
      <div className={styles.top}>
        <span className={styles.context}>Event badge</span>
      </div>
      <section className={styles.card}>
        {claimResult === 'taken' && (
          <p role="alert" className={formStyles.error}>
            ✕ This badge belongs to someone else. Ask an organizer.
          </p>
        )}
        {claimResult === 'refused' && (
          <p role="alert" className={formStyles.error}>
            ✕ This badge couldn’t be linked to you. Ask an organizer.
          </p>
        )}
        {profile === null && (
          <>
            <h1>This badge isn’t linked yet</h1>
            {claimable.length > 0 ? (
              <>
                <p>If this is your badge, link it to you. People at the event can then tap it to see what you share.</p>
                {claimable.map((c) => (
                  <form key={c.eventId} action={claim} className={formStyles.form}>
                    <input type="hidden" name="uid" value={uid} />
                    <input type="hidden" name="eventId" value={c.eventId} />
                    <button type="submit">{claimable.length > 1 ? `This is my badge for ${c.eventName}` : 'This is my badge'}</button>
                  </form>
                ))}
              </>
            ) : (
              <>
                <p>
                  You’re signed in as {viewer.email ?? 'an unknown address'}. To make it yours, sign in with the email you
                  registered for the event with.
                </p>
                <Link className={styles.link} href={`/login?next=${encodeURIComponent(`/profile/${raw}`)}`}>
                  Use a different email
                </Link>
              </>
            )}
          </>
        )}
        {profile?.allowed === false && (
          <>
            <h1>Only people at this event can see this badge</h1>
            <p>
              You’re signed in as {viewer.email ?? 'an unknown address'}. Sign in with the email you registered for the
              event with.
            </p>
            <Link className={styles.link} href={`/login?next=${encodeURIComponent(`/profile/${raw}`)}`}>
              Use a different email
            </Link>
          </>
        )}
        {profile?.allowed && !profile.public && (
          <>
            <h1>This attendee hasn’t shared a profile</h1>
            <p>They can choose to share their name and LinkedIn from their Passline account.</p>
          </>
        )}
        {profile?.allowed && profile.public && (
          <>
            <h1 className={styles.name}>{`${profile.firstName} ${profile.lastName}`.trim()}</h1>
            {profile.linkedinUrl ? (
              <a className={styles.link} href={profile.linkedinUrl} rel="noopener noreferrer">
                View LinkedIn profile
              </a>
            ) : (
              <p>No LinkedIn profile shared.</p>
            )}
          </>
        )}
      </section>
    </main>
  );
}
