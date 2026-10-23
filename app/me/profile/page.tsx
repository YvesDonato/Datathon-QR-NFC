import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { currentUser } from '@/lib/auth/session';
import { db } from '@/lib/db/server';
import { saveBadgeProfile, type SaveProfileResult } from '@/lib/me/profile';
import formStyles from '../../login/login.module.css';
import styles from '../../profile/[uid]/profile.module.css';
import me from '../me.module.css';
import { loadMyEvent, menuMetadata } from '../load';

export const metadata: Metadata = menuMetadata('Hacker profile');

const ERRORS: Partial<Record<SaveProfileResult, string>> = {
  INVALID_LINKEDIN: '✕ Not saved. Use your LinkedIn profile link, like linkedin.com/in/yourname.',
  INVALID_DIETARY: '✕ Not saved. Keep dietary notes under 500 characters.',
  NOT_FOUND: '✕ Not saved. Reload the page and try again.',
};

// SPEC F14 / §6.5: the attendee's own LinkedIn, badge sharing and dietary notes. Only their own row changes.
async function save(formData: FormData) {
  'use server';
  const user = await currentUser();
  if (!user) redirect('/login?next=/me/profile');
  const result = await saveBadgeProfile(db(), user, String(formData.get('participantId') ?? ''), {
    linkedin: String(formData.get('linkedin') ?? ''),
    profilePublic: formData.get('public') === 'on',
    dietaryNotes: String(formData.get('dietaryNotes') ?? ''),
  });
  redirect(`/me/profile?${result === 'SAVED' ? 'saved=1' : `error=${result}`}`);
}

export default async function HackerProfilePage(props: {
  searchParams: Promise<{ badge?: string; saved?: string; error?: string }>;
}) {
  const notices = await props.searchParams;
  const { me: m } = await loadMyEvent('/me/profile');
  const error = ERRORS[notices.error as SaveProfileResult];

  return (
    <main className={styles.page}>
      <div className={styles.top}>
        <Link className={me.back} href="/me">
          ← Menu
        </Link>
        <span className={styles.context}>{m.event.name}</span>
      </div>
      <h1>Hacker profile</h1>
      {notices.badge === 'linked' && (
        <p role="status" className={formStyles.ok}>
          ✓ Badge linked. Add your LinkedIn and choose whether to share it.
        </p>
      )}
      <section className={styles.card}>
        <div className={me.field}>
          <p className={me.label}>Name</p>
          <p className={styles.name}>{`${m.firstName} ${m.lastName}`.trim()}</p>
        </div>
        {m.badge ? <p className={me.chip}>✓ Badge linked.</p> : <p className={styles.meta}>No badge yet. Tap your badge with your phone to link it to you.</p>}
        <form action={save} className={formStyles.form}>
          <input type="hidden" name="participantId" value={m.participantId} />
          <label htmlFor="linkedin">LinkedIn</label>
          <input
            id="linkedin"
            name="linkedin"
            inputMode="url"
            autoComplete="url"
            placeholder="linkedin.com/in/yourname"
            defaultValue={m.linkedinUrl ?? ''}
            className={formStyles.input}
          />
          <label style={{ display: 'flex', gap: 8, alignItems: 'center', minHeight: 44 }}>
            <input type="checkbox" name="public" defaultChecked={m.profilePublic} style={{ width: 22, height: 22 }} />
            Show my name and LinkedIn when someone at the event taps my badge
          </label>
          <label htmlFor="dietaryNotes">Dietary notes</label>
          <textarea
            id="dietaryNotes"
            name="dietaryNotes"
            maxLength={500}
            placeholder="Allergies, vegetarian, halal…"
            defaultValue={m.dietaryNotes ?? ''}
            className={me.textarea}
          />
          {error && (
            <p role="alert" className={formStyles.error}>
              {error}
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
