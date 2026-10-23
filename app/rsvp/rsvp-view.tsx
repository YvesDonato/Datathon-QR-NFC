'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { safeNextPath } from '@/lib/auth/next-path';
import { formatEventDateTime } from '@/lib/domain/event-time';
import form from '../login/login.module.css';
import me from '../me/me.module.css';
import styles from '../profile/[uid]/profile.module.css';

interface Invite {
  firstName: string;
  event: { name: string; venue: string; startsAt: string; timezone: string };
  status: string;
  hasAccount: boolean;
  /** v0.6: the Sheet's dietary notes and LinkedIn, to prefill the Yes form. */
  profile: { dietaryNotes: string | null; linkedinUrl: string | null; profilePublic: boolean };
}

// 400 invalid_profile → which field to fix (F13 step 4).
const FIELD_ERRORS: Record<string, string> = {
  emergencyName: 'Enter your emergency contact’s name.',
  emergencyPhone: 'Enter your emergency contact’s phone number (at least 3 digits).',
  emergencyRelation: 'Keep the relationship under 60 characters.',
  linkedin: 'Use your LinkedIn profile link, like linkedin.com/in/yourname, or leave it blank.',
  dietaryNotes: 'Keep dietary notes under 500 characters.',
};

type View =
  | { kind: 'loading' | 'not_found' | 'rate_limited' | 'error' | 'not_going' | 'going' }
  | { kind: 'invite'; invite: Invite; yesForm: boolean };

function readToken(): string {
  try {
    return decodeURIComponent(window.location.hash.replace(/^#/, '')).trim();
  } catch {
    return ''; // malformed %-escapes
  }
}

async function post(body: object): Promise<{ status: number; data: Record<string, unknown> }> {
  try {
    const res = await fetch('/api/rsvp', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    return { status: res.status, data: ((await res.json().catch(() => ({}))) ?? {}) as Record<string, unknown> };
  } catch {
    return { status: 0, data: {} };
  }
}

// SPEC F13: answer the invitation. Yes opens one form: the emergency contact (required), the networking
// profile and dietary notes (prefilled from the Sheet), and a password (required, v0.7.2: a new one without
// an account, their own with one); then
// it signs them in and goes to /me, and the pass is emailed. No withdraws (they can change their mind until
// the event ends).
export function RsvpView() {
  const router = useRouter();
  const [view, setView] = useState<View>({ kind: 'loading' });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    // A late answer from an abandoned lookup (React runs this twice in dev) must not reset an open form.
    let stale = false;
    const token = readToken();
    void (token ? post({ token }) : Promise.resolve({ status: 404, data: {} })).then((r) => {
      if (stale) return;
      setView(
        r.status === 200
          ? { kind: 'invite', invite: r.data as unknown as Invite, yesForm: false }
          : { kind: r.status === 404 ? 'not_found' : r.status === 429 ? 'rate_limited' : 'error' },
      );
    });
    return () => {
      stale = true;
    };
  }, []);

  async function respond(going: boolean, fields: Record<string, string | boolean> = {}) {
    setBusy(true);
    setError(null);
    const r = await post({ token: readToken(), going, ...fields });
    setBusy(false);
    if (r.status === 400 && r.data.error === 'weak_password') return setError('Use 8 to 72 characters for your password.');
    if (r.status === 400 && r.data.error === 'wrong_password') {
      // The server sees an account (maybe made by an earlier try of this form): ask for its password from now on.
      setView((v) => (v.kind === 'invite' ? { ...v, invite: { ...v.invite, hasAccount: true } } : v));
      return setError('That isn’t your Passline password. Try again, or reset it on the sign-in page.');
    }
    if (r.status === 400 && r.data.error === 'password_required') return setError('Enter your password.');
    if (r.status === 400 && r.data.error === 'invalid_profile') return setError(FIELD_ERRORS[String(r.data.field)] ?? 'Check the form and try again.');
    if (r.status === 404) return setView({ kind: 'not_found' });
    if (r.status !== 200) return setError(r.status === 429 ? 'Too many tries. Wait a minute and try again.' : 'Something went wrong. Try again.');
    if (r.data.code === 'NOT_GOING') return setView({ kind: 'not_going' });
    // Where the server says (staff may need onboarding first); only our own paths.
    if (r.data.signedIn === true) return router.push(safeNextPath(typeof r.data.next === 'string' ? r.data.next : null, '/me'));
    setView({ kind: 'going' });
  }

  return (
    <main className={styles.page}>
      <div className={styles.top}>
        <span className={styles.context}>Invitation</span>
      </div>
      <section className={styles.card}>
        {view.kind === 'loading' && <p role="status">Loading…</p>}
        {view.kind === 'not_found' && (
          <>
            <h1>This invitation link doesn’t work</h1>
            <p>It may have been replaced by a newer email, or the event is over.</p>
          </>
        )}
        {(view.kind === 'rate_limited' || view.kind === 'error') && (
          <>
            <h1>Couldn’t load your invitation</h1>
            <p>{view.kind === 'rate_limited' ? 'Too many tries. Wait a minute, then reload.' : 'Check your connection, then reload.'}</p>
          </>
        )}
        {view.kind === 'going' && (
          <>
            <h1>You’re going</h1>
            <p>We’re emailing your check-in pass. You can also see it on Passline.</p>
            <p>
              <a className={styles.link} href="/login?next=%2Fme">
                Sign in to see your pass
              </a>
            </p>
          </>
        )}
        {view.kind === 'not_going' && (
          <>
            <h1>Thanks for letting us know</h1>
            <p>Changed your mind? Open the invitation link again before the event.</p>
          </>
        )}
        {view.kind === 'invite' && (
          <>
            <h1>{view.invite.event.name}</h1>
            <p className={styles.meta}>
              {formatEventDateTime(view.invite.event.startsAt, view.invite.event.timezone)} · {view.invite.event.venue}
            </p>
            <p>
              Hi {view.invite.firstName}, will you be there?
              {view.invite.status === 'accepted' && ' (You said yes.)'}
              {view.invite.status === 'withdrawn' && ' (You said no. You can still change your mind.)'}
            </p>
            {view.yesForm ? (
              <form
                className={form.form}
                onSubmit={(e) => {
                  e.preventDefault();
                  const d = new FormData(e.currentTarget);
                  const text = (k: string) => String(d.get(k) ?? '');
                  void respond(true, {
                    emergencyName: text('emergencyName'),
                    emergencyPhone: text('emergencyPhone'),
                    emergencyRelation: text('emergencyRelation'),
                    dietaryNotes: text('dietaryNotes'),
                    linkedin: text('linkedin'),
                    profilePublic: d.get('public') === 'on',
                    lookingForTeam: d.get('lookingForTeam') === 'on',
                    password: text('password'),
                  });
                }}
              >
                <h2>Emergency contact</h2>
                <p className={styles.meta}>Who we call if something happens to you. Only the organizers see it.</p>
                <label htmlFor="emergencyName">Emergency contact name</label>
                <input id="emergencyName" name="emergencyName" required maxLength={100} autoComplete="off" className={form.input} />
                <label htmlFor="emergencyPhone">Emergency contact phone</label>
                <input id="emergencyPhone" name="emergencyPhone" type="tel" required maxLength={30} autoComplete="off" className={form.input} />
                <label htmlFor="emergencyRelation">Relationship (optional)</label>
                <input id="emergencyRelation" name="emergencyRelation" maxLength={60} placeholder="Parent, partner, friend…" autoComplete="off" className={form.input} />

                <label htmlFor="dietaryNotes">Dietary notes</label>
                <textarea
                  id="dietaryNotes"
                  name="dietaryNotes"
                  maxLength={500}
                  placeholder="Allergies, vegetarian, halal…"
                  defaultValue={view.invite.profile.dietaryNotes ?? ''}
                  className={me.textarea}
                />

                <h2>Networking profile (optional)</h2>
                <p className={styles.meta}>People at the event can tap your badge to see it, if you share it.</p>
                <label htmlFor="linkedin">LinkedIn</label>
                <input
                  id="linkedin"
                  name="linkedin"
                  inputMode="url"
                  autoComplete="url"
                  placeholder="linkedin.com/in/yourname"
                  defaultValue={view.invite.profile.linkedinUrl ?? ''}
                  className={form.input}
                />
                <label style={{ display: 'flex', gap: 8, alignItems: 'center', minHeight: 44 }}>
                  <input type="checkbox" name="public" defaultChecked={view.invite.profile.profilePublic} style={{ width: 22, height: 22 }} />
                  Show my name and LinkedIn when someone at the event taps my badge
                </label>

                <label style={{ display: 'flex', gap: 8, alignItems: 'center', minHeight: 44 }}>
                  <input type="checkbox" name="lookingForTeam" style={{ width: 22, height: 22 }} />
                  I&apos;m looking for a team: list me in the teammate directory (name only)
                </label>

                {view.invite.hasAccount ? (
                  <>
                    <label htmlFor="password">Your Passline password</label>
                    <input id="password" name="password" type="password" required maxLength={200} autoComplete="current-password" className={form.input} />
                    <p className={styles.meta}>
                      You already have a Passline account with this email.{' '}
                      <a className={form.linkButton} style={{ display: 'inline-flex', alignItems: 'center' }} href="/login" target="_blank" rel="noopener">
                        Forgot it?
                      </a>
                    </p>
                  </>
                ) : (
                  <>
                    <label htmlFor="password">Set a password for your Passline account</label>
                    <input id="password" name="password" type="password" required minLength={8} maxLength={72} autoComplete="new-password" className={form.input} />
                  </>
                )}
                <button type="submit" disabled={busy}>
                  {busy ? 'Saving…' : 'Yes, I’ll be there'}
                </button>
              </form>
            ) : (
              <div className={form.form}>
                <button type="button" disabled={busy} onClick={() => setView({ ...view, yesForm: true })}>
                  Yes, I’ll be there
                </button>
                <button type="button" className={form.linkButton} disabled={busy} onClick={() => void respond(false)}>
                  No, I can’t make it
                </button>
              </div>
            )}
            {error && (
              <p role="alert" className={form.error}>
                ✕ {error}
              </p>
            )}
          </>
        )}
      </section>
    </main>
  );
}
