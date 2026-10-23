import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { after } from 'next/server';
import { currentUser } from '@/lib/auth/session';
import { db } from '@/lib/db/server';
import { emailFrom, getProvider } from '@/lib/email';
import { drainUntilIdle } from '@/lib/email/drain';
import { env } from '@/lib/env';
import { formatJoinCode } from '@/lib/domain/team';
import { myEvent } from '@/lib/me/profile';
import { createTeam, declineInvite, inviteTeammate, joinTeam, leaveTeam, myTeam, setLooking, setTeamTrack, type TeamCode } from '@/lib/me/team';
import formStyles from '../../login/login.module.css';
import styles from '../../profile/[uid]/profile.module.css';
import me from '../me.module.css';
import { loadMyEvent, menuMetadata } from '../load';

export const metadata: Metadata = menuMetadata('Team');

const initials = (name: string) => name.split(/\s+/).map((w) => Array.from(w)[0] ?? '').join('').slice(0, 2).toUpperCase();

const NOTICES: Record<TeamCode, string> = {
  CREATED: '✓ Team created. Share the code with your teammates.',
  JOINED: '✓ You joined the team.',
  LEFT: '✓ You left the team.',
  SAVED: '✓ Track saved.',
  INVITED: '✓ Invite sent. They can accept on their Team page.',
  ALREADY_INVITED: '✕ You’ve already invited them.',
  NOT_LOOKING: '✕ They’re no longer looking for a team.',
  DECLINED: '✓ Invite declined.',
  IN_A_TEAM: '✕ You’re already in a team. Leave it first.',
  NAME_TAKEN: '✕ Another team already has that name.',
  BAD_CODE: '✕ No team has that code. Check it and try again.',
  TEAM_FULL: '✕ That team already has 4 people.',
  CLOSED: '✕ Teams are closed right now. Ask an organizer.',
  NOT_RELEASED: '✕ Tracks aren’t released yet.',
  NOT_FOUND: '✕ Something changed. Reload the page and try again.',
  INVALID_NAME: '✕ Give your team a name, up to 60 characters.',
};

// SPEC F15 (v0.7): create, join, leave and pick a track. The participant comes from the session, never the form.
async function act(formData: FormData) {
  'use server';
  const user = await currentUser();
  if (!user) redirect('/login?next=/me/team');
  const m = await myEvent(db(), user.email ?? '', new Date());
  if (!m) redirect('/me/team?r=NOT_FOUND');
  const field = (k: string) => String(formData.get(k) ?? '');
  const op = field('op');
  const r =
    op === 'invite' ? await inviteTeammate(db(), user, m.participantId, field('inviteeId'))
    : op === 'accept' ? await joinTeam(db(), user, m.participantId, { teamId: field('teamId') })
    : op === 'decline' ? await declineInvite(db(), user, m.participantId, field('teamId'))
    : op === 'looking' ? await setLooking(db(), user, m.participantId, field('looking') === 'on')
    : op === 'create'
      ? await createTeam(db(), user, m.participantId, field('name'))
      : op === 'join'
        ? await joinTeam(db(), user, m.participantId, { code: field('code') })
        : op === 'leave'
          ? await leaveTeam(db(), user, m.participantId)
          : await setTeamTrack(db(), user, m.participantId, field('trackId'));
  if (r === 'INVITED') after(() => drainUntilIdle({ db: db(), provider: getProvider(), appOrigin: env().NEXT_PUBLIC_APP_ORIGIN, from: emailFrom(), passSecret: env().PASS_TOKEN_SECRET }));
  redirect(`/me/team?r=${r}`);
}

export default async function TeamPage(props: { searchParams: Promise<{ r?: string }> }) {
  const { r } = await props.searchParams;
  const { me: m, now } = await loadMyEvent('/me/team');
  const { tracks, team, invites, directory } = await myTeam(db(), m);
  const live = Date.parse(m.event.endsAt) > now.getTime();
  const open = m.event.teamsOpen && live;
  const notice = r === 'SAVED' && !team ? '✓ Directory preference saved.' : r && r in NOTICES ? NOTICES[r as TeamCode] : null;
  const trackName = tracks.find((t) => t.id === team?.trackId)?.name;

  return (
    <main className={styles.page}>
      <div className={styles.top}>
        <Link className={me.back} href="/me">
          ← Menu
        </Link>
        <span className={styles.context}>{m.event.name}</span>
      </div>
      <h1>Team</h1>
      {notice && (
        <p role={notice.startsWith('✓') ? 'status' : 'alert'} className={notice.startsWith('✓') ? formStyles.ok : formStyles.error}>
          {notice}
        </p>
      )}
      {!team && live && (
        <section aria-labelledby="looking-title" className={styles.card}>
          <h2 id="looking-title">Find teammates</h2>
          <form action={act} className={formStyles.form}>
            <input type="hidden" name="op" value="looking" />
            <label style={{ display: 'flex', gap: 8, alignItems: 'center', minHeight: 44 }}>
              <input type="checkbox" name="looking" defaultChecked={m.lookingForTeam} style={{ width: 22, height: 22 }} />
              Looking for a team
            </label>
            <p className={styles.meta}>List my name in the teammate directory for this event.</p>
            <button type="submit">Save directory preference</button>
          </form>
        </section>
      )}
      {!team && invites.length > 0 && (
        <section aria-labelledby="invites-title" className={styles.card}>
          <h2 id="invites-title">Pending invites</h2>
          <ul className={me.people}>
            {invites.map((invite) => (
              <li key={invite.teamId}>
                <p>
                  {invite.from} invited you to join {invite.teamName}.
                </p>
                <div className={me.row}>
                  {open && (
                    <form action={act}>
                      <input type="hidden" name="op" value="accept" />
                      <input type="hidden" name="teamId" value={invite.teamId} />
                      <button type="submit">Accept</button>
                    </form>
                  )}
                  <form action={act}>
                    <input type="hidden" name="op" value="decline" />
                    <input type="hidden" name="teamId" value={invite.teamId} />
                    <button type="submit" className={formStyles.secondary}>
                      Decline
                    </button>
                  </form>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
      {team ? (
        <section aria-labelledby="team-name" className={styles.card}>
          <h2 id="team-name">{team.name}</h2>
          <ul className={me.members}>
            {team.members.map((name) => (
              <li key={name}>
                <span className={me.initials} aria-hidden="true">
                  {initials(name)}
                </span>
                {name}
              </li>
            ))}
          </ul>
          <div className={me.code}>
            <span className={me.label}>Join code</span>
            <strong className={me.codeValue}>{formatJoinCode(team.code)}</strong>
            <span className={styles.meta}>Share it with your teammates (4 people at most).</span>
          </div>
          <div className={me.divider}>
            <h3>Track</h3>
            {!m.event.tracksReleased ? (
              <p>Tracks are announced at the hackathon.</p>
            ) : live && tracks.length > 0 ? (
              <form action={act} className={formStyles.form}>
                <input type="hidden" name="op" value="track" />
                <label htmlFor="trackId">Your team’s track</label>
                <select id="trackId" name="trackId" defaultValue={team.trackId ?? ''} required className={formStyles.input}>
                  <option value="" disabled>
                    Pick a track
                  </option>
                  {tracks.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
                <button type="submit">Save track</button>
              </form>
            ) : (
              <p>{trackName ?? 'No track chosen.'}</p>
            )}
          </div>
          {open && (
            <form action={act} className={`${formStyles.form} ${me.divider}`}>
              <input type="hidden" name="op" value="leave" />
              {team.members.length === 1 && <p className={styles.meta}>You’re the only member: leaving deletes the team.</p>}
              <button type="submit" className={formStyles.secondary}>
                Leave team
              </button>
            </form>
          )}
        </section>
      ) : !open ? (
        <section className={styles.card}>
          <p>{live ? 'Teams open on hackathon day. Come back then to create or join one.' : 'The event is over.'}</p>
        </section>
      ) : (
        <>
          <section aria-labelledby="create" className={styles.card}>
            <h2 id="create">Create a team</h2>
            <form action={act} className={formStyles.form}>
              <input type="hidden" name="op" value="create" />
              <label htmlFor="name">Team name</label>
              <input id="name" name="name" required maxLength={60} autoComplete="off" className={formStyles.input} />
              <button type="submit">Create team</button>
            </form>
          </section>
          <section aria-labelledby="join" className={styles.card}>
            <h2 id="join">Join with a code</h2>
            <form action={act} className={formStyles.form}>
              <input type="hidden" name="op" value="join" />
              <label htmlFor="code">Join code</label>
              <input id="code" name="code" required maxLength={20} autoComplete="off" autoCapitalize="characters" placeholder="ABCD-EFGH" className={formStyles.input} />
              <button type="submit">Join team</button>
            </form>
          </section>
        </>
      )}
      {open && (!team || team.members.length < 4) && (
        <section aria-labelledby="directory-title" className={styles.card}>
          <h2 id="directory-title">Teammate directory</h2>
          {!team && <p className={styles.meta}>Create a team to invite them.</p>}
          {directory.length === 0 ? <p className={styles.meta}>No one is looking for a team yet.</p> : (
            <ul className={me.people}>
              {directory.map((person) => (
                <li key={person.id}>
                  {person.name}
                  {team && (
                    <form action={act}>
                      <input type="hidden" name="op" value="invite" />
                      <input type="hidden" name="inviteeId" value={person.id} />
                      <button type="submit" className={formStyles.secondary} aria-label={`Invite ${person.name}`}>
                        Invite
                      </button>
                    </form>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </main>
  );
}
