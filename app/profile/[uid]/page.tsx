
import { Entrance } from '@/components/motion';
import { BrandMark } from '@/components/brand-mark';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { connection } from 'next/server';
import { headers } from 'next/headers';
import { z } from 'zod';
import { currentUser } from '@/lib/auth/session';
import { db } from '@/lib/db/server';
import { clientIpKey } from '@/lib/http/ip';
import { IP_CEILING_PER_MIN, withinLimit } from '@/lib/pass/handlers';
import { normalizeUid } from '@/lib/domain/badge';
import { normalizeEmail } from '@/lib/domain/normalize';
import { connect, connectionState, type ConnectionState } from '@/lib/me/connections';
import { CopyButton } from './copy-button';
import { DiscordIcon, GlobeIcon, LinkedInIcon } from '@/app/me/icons';

// SPEC §6.5: what a phone opens when it taps a badge. Public since v0.9: no sign-in needed, and
// badge_profile() returns only what the holder shares. The holder's own tap opens their menu.
// Staff link unlinked badges at check-in (v0.10). v0.9.2: Discord and website too.
// `?tap` (on tags written by the earlier datathon-badges app) is ignored.
export const metadata: Metadata = {
  title: 'Badge · Datathon',
  referrer: 'no-referrer',
  robots: { index: false, follow: false },
};

const profileSchema = z
  .union([
    z.object({ allowed: z.literal(true), public: z.literal(false) }),
    z.object({
      allowed: z.literal(true),
      public: z.literal(true),
      firstName: z.string(),
      lastName: z.string(),
      linkedinUrl: z.string().nullable(),
      discord: z.string().nullable(),
      websiteUrl: z.string().nullable(),
    }),
  ])
  .nullable();

// "https://ada.dev/" → "ada.dev", "https://github.com/ada" → "github.com/ada".
const siteLabel = (href: string) => {
  const url = new URL(href);
  return `${url.host}${url.pathname}${url.search}`.replace(/\/$/, '');
};

// "https://www.linkedin.com/in/ada-l/" → "in/ada-l" (accents decoded back for reading).
const linkedinLabel = (href: string) => {
  const path = new URL(href).pathname.replace(/\/$/, '').replace(/^\//, '');
  try {
    return decodeURIComponent(path);
  } catch {
    return path;
  }
};

const ROW = 'flex flex-wrap items-center gap-[4px_12px] min-h-[60px] py-[8px] [border-top:1px_solid_var(--line)]';
// On a phone the icon alone names the row (the word stays for screen readers), leaving the value room.
const LABEL = 'shrink-0 inline-flex items-center gap-[10px] sm:w-[112px] text-muted-foreground text-[12px] tracking-[0.08em] uppercase';
const LABEL_TEXT = 'sr-only sm:not-sr-only';
const ICON = 'w-[20px] h-[20px] shrink-0 text-accent';
const VALUE = 'flex-1 min-w-[8ch] [overflow-wrap:anywhere] font-semibold';
const ACTION = 'min-w-[88px]';

// SPEC F17 (v0.12): Connect is a POST from a button; the tapper is the signed-in account, never the badge.
async function connectAction(formData: FormData) {
  'use server';
  const uid = normalizeUid(String(formData.get('uid') ?? ''));
  if (!uid) notFound();
  const user = await currentUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(`/profile/${uid}`)}`);
  const { code } = await connect(db(), user, uid);
  redirect(`/profile/${uid}${code === 'RATE_LIMITED' ? '?c=RATE_LIMITED' : ''}`);
}

export default async function BadgeProfilePage(props: { params: Promise<{ uid: string }>; searchParams: Promise<{ c?: string }> }) {
  await connection(); // per request: an opt-out must take effect on the next view
  const raw = (await props.params).uid;
  const uid = normalizeUid(raw);
  if (!uid) notFound();
  // M5: public by design, but short UIDs are enumerable, so throttle per client IP (hashed key
  // only, I-11) before touching the DB. Same venue-NAT ceiling as the pass endpoints: a whole hall
  // can share one egress IP. Over the limit the page answers 200 with a neutral retry note in the
  // usual shell — no profile data and no existence signal either way (a 404 would imply unlinked).
  if (!(await withinLimit(db(), clientIpKey(await headers(), 'profile'), 60, IP_CEILING_PER_MIN))) {
    return (
      <Entrance><main className="max-w-[520px] m-[0px_auto] p-[24px_16px_56px] flex flex-col gap-[16px] [:where(&)_>_*]:mt-0

          [:where(&)_>_*]:mb-0">
        <BrandMark className="min-h-11 mb-[8px]" />
        <Card className="[&>p]:m-0 [&>h2]:text-lg " asChild><section >
          <h1>Too many requests</h1>
          <p className="copy">Try again shortly.</p>
        </section></Card>
      </main></Entrance>
    );
  }
  const viewer = await currentUser();

  const { data, error } = await db().rpc('badge_profile', {
    p_uid: uid,
    ...(viewer && { p_viewer_id: viewer.id, p_viewer_email: normalizeEmail(viewer.email ?? '') }),
  });
  if (error) throw new Error(`badge_profile failed (${error.code})`);
  // v0.6 (F14): the holder tapping their own badge opens their hacker menu.
  if (z.object({ self: z.literal(true) }).safeParse(data).success) redirect('/me');
  const profile = profileSchema.parse(data);
  const state: ConnectionState | null = profile && viewer ? await connectionState(db(), viewer, uid) : null;
  const limited = (await props.searchParams).c === 'RATE_LIMITED';
  // A private profile shows no name (§6.5), so the Connect wording doesn't either.
  const name = profile?.public ? profile.firstName : null;

  return (
    <Entrance><main className="max-w-[520px] m-[0px_auto] p-[24px_16px_56px] flex flex-col gap-[16px] [:where(&)_>_*]:mt-0

          [:where(&)_>_*]:mb-0">
      <BrandMark className="min-h-11 mb-[8px]" />
      <Card className="[&>p]:m-0 [&>h2]:text-lg " asChild><section >
        {profile === null && (
          <>
            <h1>This badge isn’t linked yet</h1>
            <p className="copy">Staff link badges at the check-in desk.</p>
          </>
        )}
        {profile && !profile.public && (
          <>
            <h1>This attendee hasn’t shared a profile</h1>
            <p className="copy">They can choose to share their name and links from their Datathon account.</p>
          </>
        )}
        {profile?.public && (
          <>
            <header className="grid gap-[4px]">
              <p className="m-0 text-muted-foreground text-[12px] tracking-[0.12em] uppercase">Hacker profile</p>
              <h1 className="m-0 text-[28px] font-semibold leading-[1.2] [overflow-wrap:anywhere]">{`${profile.firstName} ${profile.lastName}`.trim()}</h1>
            </header>
            {/* One row per link, all alike: what it is, its value, one action (owner's request, v0.12.4). */}
            {(profile.linkedinUrl || profile.discord || profile.websiteUrl) ? (
              <ul className="m-0 p-0 list-none grid">
                {profile.linkedinUrl && (
                  <li className={ROW}>
                    <span className={LABEL}><LinkedInIcon className={ICON} /><span className={LABEL_TEXT}>LinkedIn</span></span>
                    <span className={VALUE}>{linkedinLabel(profile.linkedinUrl)}</span>
                    <Button variant="outline" size="sm" className={ACTION} asChild>
                      <a href={profile.linkedinUrl} rel="noopener noreferrer" aria-label={`Open ${profile.firstName}’s LinkedIn profile`}>Open ↗</a>
                    </Button>
                  </li>
                )}
                {profile.discord && (
                  <li className={ROW}>
                    <span className={LABEL}><DiscordIcon className={ICON} /><span className={LABEL_TEXT}>Discord</span></span>
                    <span className={VALUE}>@{profile.discord}</span>
                    <CopyButton text={profile.discord} label="Copy Discord username" className={ACTION} />
                  </li>
                )}
                {profile.websiteUrl && (
                  <li className={ROW}>
                    <span className={LABEL}><GlobeIcon className={ICON} /><span className={LABEL_TEXT}>Website</span></span>
                    <span className={VALUE}>{siteLabel(profile.websiteUrl)}</span>
                    {/* The holder typed this link: nofollow/ugc, and its address is in the name so the tapper knows where it goes. */}
                    <Button variant="outline" size="sm" className={ACTION} asChild>
                      <a href={profile.websiteUrl} rel="nofollow noopener noreferrer ugc" aria-label={`Open ${siteLabel(profile.websiteUrl)}`}>Open ↗</a>
                    </Button>
                  </li>
                )}
              </ul>
            ) : (
              <p className="copy text-muted-foreground">No links shared.</p>
            )}
          </>
        )}
        {profile && state && <Connect uid={uid} name={name} state={state} />}
        {limited && <p role="alert" className="text-bad">✕ Too many connects in a short time. Wait a few minutes and try again.</p>}
      </section></Card>
    </main></Entrance>
  );
}

// The connection game (F17): what the signed-in viewer can do with this badge. Not an attendee of this event,
// an unknown badge or their own: nothing.
function Connect(props: { uid: string; name: string | null; state: ConnectionState }) {
  const { uid, name, state } = props;
  const button = (label: string) => (
    <form action={connectAction}>
      <input type="hidden" name="uid" value={uid} />
      <Button type="submit">{label}</Button>
    </form>
  );
  const box = 'grid gap-[8px] pt-[12px] [border-top-width:1px] [border-top-style:solid] [border-top-color:var(--line)]';
  switch (state) {
    case 'NONE':
      return <div className={box}>{button(name ? `Connect with ${name}` : 'Connect')}</div>;
    case 'RECEIVED':
      return (
        <div className={box}>
          <p className="m-0">{name ?? 'They'} tapped your badge. Connect back to make it count.</p>
          {button(name ? `Connect back with ${name}` : 'Connect back')}
        </div>
      );
    case 'SENT':
      return <p role="status" className={`${box} m-0`}>Sent! It counts once {name ?? 'they'} tap{name ? 's' : ''} your badge too.</p>;
    case 'MUTUAL':
      return <p role="status" className={`${box} m-0 text-ok`}>✓ You’re connected{name ? ` with ${name}` : ''}.</p>;
    case 'NOT_CHECKED_IN':
      return <p className={`${box} m-0 text-muted-foreground`}>Check in at the door first, then you can connect.</p>;
    case 'CLOSED':
      return <p className={`${box} m-0 text-muted-foreground`}>Connecting closed when the event ended.</p>;
    default:
      return null;
  }
}
