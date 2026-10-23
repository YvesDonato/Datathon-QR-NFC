import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { currentUser } from '@/lib/auth/session';
import { db } from '@/lib/db/server';
import { saveBadgeProfile } from '@/lib/me/profile';
import formStyles from '../../login/login.module.css';
import styles from '../../profile/[uid]/profile.module.css';
import me from '../me.module.css';
import { loadMyEvent, menuMetadata } from '../load';

export const metadata: Metadata = menuMetadata('Emergency contact');

// parseProfileInput's phone rule as an HTML pattern (v-flag syntax): the DB's characters, at least 3 digits.
const PHONE_PATTERN = '(?=(?:\\D*\\d){3})[0-9+\\(\\) .\\-]{3,30}';

// SPEC F14: the event's emergency info (organizers write it on the Info page) and the attendee's own
// emergency contact, which only organizers see.
async function save(formData: FormData) {
  'use server';
  const user = await currentUser();
  if (!user) redirect('/login?next=/me/emergency');
  const result = await saveBadgeProfile(db(), user, String(formData.get('participantId') ?? ''), {
    emergencyName: String(formData.get('emergencyName') ?? ''),
    emergencyPhone: String(formData.get('emergencyPhone') ?? ''),
    emergencyRelation: String(formData.get('emergencyRelation') ?? ''),
  });
  redirect(`/me/emergency?${result === 'SAVED' ? 'saved=1' : `error=${result}`}`);
}

export default async function EmergencyPage(props: { searchParams: Promise<{ saved?: string; error?: string }> }) {
  const notices = await props.searchParams;
  const { me: m } = await loadMyEvent('/me/emergency');

  return (
    <main className={styles.page}>
      <div className={styles.top}>
        <Link className={me.back} href="/me">
          ← Menu
        </Link>
        <span className={styles.context}>{m.event.name}</span>
      </div>
      <h1>Emergency contact</h1>
      <section aria-labelledby="event-help" className={styles.card}>
        <h2 id="event-help">During the event</h2>
        <p className={me.text}>{m.event.emergencyInfo || 'The organizers haven’t posted emergency info yet. Find an organizer at the venue.'}</p>
      </section>
      <section aria-labelledby="own-contact" className={styles.card}>
        <h2 id="own-contact">Your emergency contact</h2>
        <p className={styles.meta}>Who we call if something happens to you. Only the organizers see it, and it’s deleted 30 days after the event.</p>
        <form action={save} className={formStyles.form}>
          <input type="hidden" name="participantId" value={m.participantId} />
          <label htmlFor="emergencyName">Name</label>
          <input id="emergencyName" name="emergencyName" required maxLength={100} autoComplete="off" defaultValue={m.emergency?.name ?? ''} className={formStyles.input} />
          <label htmlFor="emergencyPhone">Phone</label>
          {/* The pattern catches a typo before submitting, so it doesn't clear the form (the server checks again). */}
          <input
            id="emergencyPhone"
            name="emergencyPhone"
            type="tel"
            required
            maxLength={30}
            pattern={PHONE_PATTERN}
            title="A phone number: digits, spaces and + ( ) - ."
            autoComplete="off"
            defaultValue={m.emergency?.phone ?? ''}
            className={formStyles.input}
          />
          <label htmlFor="emergencyRelation">Relationship (optional)</label>
          <input
            id="emergencyRelation"
            name="emergencyRelation"
            maxLength={60}
            placeholder="Parent, partner, friend…"
            autoComplete="off"
            defaultValue={m.emergency?.relation ?? ''}
            className={formStyles.input}
          />
          {notices.error && (
            <p role="alert" className={formStyles.error}>
              {notices.error === 'INVALID_CONTACT' ? '✕ Not saved. Enter a name and a phone number with at least 3 digits.' : '✕ Not saved. Reload the page and try again.'}
            </p>
          )}
          {notices.saved && (
            <p role="status" className={formStyles.ok}>
              ✓ Saved.
            </p>
          )}
          <button type="submit">Save</button>
        </form>
      </section>
    </main>
  );
}
