import type { Metadata } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { db } from '@/lib/db/server';
import { formatEventDateTime } from '@/lib/domain/event-time';
import { env } from '@/lib/env';
import { myPasses } from '@/lib/pass/mine';
import form from '../login/login.module.css';
import styles from '../profile/[uid]/profile.module.css';
import { ChevronIcon, EmergencyIcon, ProfileIcon, QrIcon, ScheduleIcon, TeamIcon } from './icons';
import { loadMe, menuMetadata } from './load';
import me from './me.module.css';

export const metadata: Metadata = menuMetadata('Menu');

// SPEC F14 (v0.6.1): the hacker menu for your event (tapping your own badge opens it), and links for staff
// (v0.4.1). The pass link carries the token only in the fragment (I-3), and the page never sends a referrer.
export default async function MePage() {
  const { user, now, me: m } = await loadMe('/me');
  const pass = m ? (await myPasses(db(), user.email ?? '', env().PASS_TOKEN_SECRET, new Date())).find((p) => p.participantId === m.participantId)?.pass : undefined;
  // v0.4.1: staff get links to their events (the admin and scanner pages check the role again).
  const { data: roles, error } = await db()
    .from('event_staff')
    .select('role, events!inner(slug, name, starts_at)')
    .eq('user_id', user.id)
    .order('starts_at', { referencedTable: 'events', ascending: false });
  if (error) throw new Error(`event_staff lookup failed (${error.code})`);

  const live = m ? Date.parse(m.event.endsAt) > now.getTime() : false;
  const teamHint = !m ? '' : m.teamId ? 'You’re in a team' : !live ? '' : m.event.teamsOpen ? 'Create or join a team' : 'Opens on hackathon day';

  return (
    <main className={styles.page}>
      {m ? (
        <>
          <header className={me.hero}>
            <h1>{m.event.name}</h1>
            <p>{formatEventDateTime(m.event.startsAt, m.event.timezone)}</p>
            <p>{m.event.venue}</p>
          </header>
          <p>Hi {m.firstName}.</p>
          <nav aria-label="Hacker menu" className={me.nav}>
            {typeof pass === 'object' ? (
              // A plain link: the token is in the fragment (I-3), which client navigation must not touch.
              <a className={me.pass} href={`/p#${pass.token}`}>
                <span className={me.passIcon}>
                  <QrIcon />
                </span>
                <span className={me.passText}>
                  My pass
                  <small>Your QR code for the door</small>
                </span>
                <ChevronIcon className={me.chevron} />
              </a>
            ) : (
              <p className={me.pass}>
                <span className={me.passIcon}>
                  <QrIcon />
                </span>
                <span className={me.passText}>
                  My pass
                  <small>{pass === 'in_email' ? 'In your email' : pass === 'on_its_way' ? 'On its way by email' : 'The event is over'}</small>
                </span>
              </p>
            )}
            <ul className={me.menu}>
              <Item href="/me/profile" icon={<ProfileIcon className={me.itemIcon} />} label="Hacker profile" hint={m.badge ? 'Badge linked' : 'No badge linked yet'} />
              <Item href="/me/team" icon={<TeamIcon className={me.itemIcon} />} label="Team" hint={teamHint} />
              <Item href="/me/schedule" icon={<ScheduleIcon className={me.itemIcon} />} label="Schedule" hint={m.event.schedule ? '' : 'Not posted yet'} />
              <Item
                href="/me/emergency"
                icon={<EmergencyIcon className={me.itemIcon} />}
                label="Emergency contact"
                hint={m.emergency ? m.emergency.name : 'Not set'}
                warn={!m.emergency}
              />
            </ul>
          </nav>
        </>
      ) : (
        <h1>My events</h1>
      )}
      {roles.length > 0 && (
        <section aria-labelledby="staff-heading" className={me.staff}>
          <h2 id="staff-heading">Staff</h2>
          {roles.map(({ role, events: e }) => (
            <div key={e.slug} className={styles.card}>
              <h3>{e.name}</h3>
              <p className={me.role}>{role === 'organizer' ? 'Organizer' : 'Volunteer'}</p>
              <div className={me.row}>
                {role === 'organizer' && (
                  <a className={styles.link} href={`/admin/${e.slug}`} aria-label={`Admin: ${e.name}`}>
                    Admin
                  </a>
                )}
                <a className={styles.link} href={`/scan/${e.slug}`} aria-label={`Scanner: ${e.name}`}>
                  Scanner
                </a>
              </div>
            </div>
          ))}
        </section>
      )}
      {!m && roles.length === 0 && <p>No upcoming events yet. When you answer Yes to an invitation, your event shows up here.</p>}
      <footer className={me.footer}>
        <p>Signed in as {user.email}.</p>
        <form action="/auth/signout" method="post">
          <button type="submit" className={form.secondary}>
            Sign out
          </button>
        </form>
      </footer>
    </main>
  );
}

function Item(props: { href: string; icon: ReactNode; label: string; hint: string; warn?: boolean }) {
  return (
    <li>
      <Link className={me.item} href={props.href}>
        {props.icon}
        <span className={me.itemText}>
          {props.label}
          {props.hint && <small data-tone={props.warn ? 'warn' : undefined}>{props.hint}</small>}
        </span>
        <ChevronIcon className={me.chevron} />
      </Link>
    </li>
  );
}
