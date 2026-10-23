'use client';

import Image from 'next/image';
import QRCode from 'qrcode';
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { formatEventDateTime } from '@/lib/domain/event-time';
import { QR_OPTIONS } from '@/lib/qr/options';
import styles from './pass.module.css';

interface ActivePass {
  state: 'active';
  firstName: string;
  event: { name: string; venue: string; startsAt: string; timezone: string };
  photo: { url: string | null; updatedAt: string | null };
  photoLocked: boolean;
  profile: { public: boolean; hasLinkedin: boolean };
}

type View =
  | { kind: 'loading' }
  | { kind: 'active'; pass: ActivePass }
  | { kind: 'replaced' | 'cancelled' | 'not_found' | 'rate_limited' | 'error' };

const APP_ORIGIN = process.env.NEXT_PUBLIC_APP_ORIGIN ?? '';
const MAX_SIDE = 2048;

function readToken(): string {
  try {
    return decodeURIComponent(window.location.hash.replace(/^#/, '')).trim();
  } catch {
    return ''; // malformed %-escapes
  }
}

function subscribeHash(onChange: () => void) {
  window.addEventListener('hashchange', onChange);
  return () => window.removeEventListener('hashchange', onChange);
}

function isActivePass(v: unknown): v is ActivePass {
  return typeof v === 'object' && v !== null && 'state' in v && v.state === 'active' && 'firstName' in v && 'event' in v;
}

// Vercel caps request bodies at 4.5 MB, so the browser shrinks the photo first (S4 decision).
// createImageBitmap applies EXIF orientation; the server still validates and re-processes everything.
async function shrink(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('no canvas');
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('encode failed'))), 'image/jpeg', 0.85),
  );
}

const PHOTO_ERRORS: Record<number, string> = {
  409: "Your photo is locked because you've already checked in.",
  413: 'That photo is too large. Please pick a smaller one.',
  415: "That file isn't a supported image. Please use a JPEG, PNG or WebP photo.",
  429: "You've changed your photo a lot recently. Please try again in an hour.",
};

async function fetchPass(token: string): Promise<View> {
  try {
    const res = await fetch('/api/pass', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token }),
      cache: 'no-store',
    });
    if (res.status === 429) return { kind: 'rate_limited' };
    if (res.status === 404) return { kind: 'not_found' };
    if (!res.ok) return { kind: 'error' };
    const body: unknown = await res.json();
    if (isActivePass(body)) return { kind: 'active', pass: body };
    const state = typeof body === 'object' && body !== null && 'state' in body ? body.state : null;
    return { kind: state === 'replaced' || state === 'cancelled' ? state : 'error' };
  } catch {
    return { kind: 'error' };
  }
}

export function PassView() {
  const [view, setView] = useState<View>({ kind: 'loading' });
  const [reloads, setReloads] = useState(0);
  // The fragment is only readable in the browser; on the server render the token is null (loading).
  const token = useSyncExternalStore(subscribeHash, readToken, () => null);
  const reload = useCallback(() => setReloads((n) => n + 1), []);

  useEffect(() => {
    if (!token) return;
    let stale = false;
    void fetchPass(token).then((next) => {
      if (!stale) setView(next);
    });
    return () => {
      stale = true;
    };
  }, [token, reloads]);

  const shown: View = token === '' ? { kind: 'not_found' } : view;

  return (
    <main className={styles.page}>
      {shown.kind === 'loading' && <p aria-live="polite">Loading your pass…</p>}
      {shown.kind === 'active' && token && <ActiveView pass={shown.pass} token={token} onChanged={reload} />}
      {shown.kind === 'replaced' && (
        <Status tone="warn" icon="!" title="This pass was replaced">
          Check your most recent email for your current pass.
        </Status>
      )}
      {shown.kind === 'cancelled' && (
        <Status tone="bad" icon="✕" title="This pass is no longer valid">
          Please contact the organizers.
        </Status>
      )}
      {shown.kind === 'not_found' && (
        <Status tone="bad" icon="?" title="Pass not found">
          Open the link from your pass email again.
        </Status>
      )}
      {shown.kind === 'rate_limited' && (
        <Status tone="warn" icon="!" title="Too many attempts">
          Please wait a minute and reload the page.
        </Status>
      )}
      {shown.kind === 'error' && (
        <Status tone="warn" icon="!" title="Couldn't load your pass">
          Check your connection and try again.{' '}
          <button type="button" onClick={reload}>
            Retry
          </button>
        </Status>
      )}
    </main>
  );
}

function Status(props: { tone: 'warn' | 'bad'; icon: string; title: string; children: React.ReactNode }) {
  return (
    <section className={`${styles.card} ${styles.status}`} role="status">
      <span className={`${styles.icon} ${styles[props.tone]}`} aria-hidden="true">
        {props.icon}
      </span>
      <div>
        <h1>{props.title}</h1>
        <p>{props.children}</p>
      </div>
    </section>
  );
}

function ActiveView({ pass, token, onChanged }: { pass: ActivePass; token: string; onChanged: () => void }) {
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    // I-4: the payload is exactly `${APP_ORIGIN}/p#${token}`.
    const el = canvas.current;
    if (!el) return;
    void QRCode.toCanvas(el, `${APP_ORIGIN}/p#${token}`, QR_OPTIONS).then(() => {
      // toCanvas pins an inline 600 px size; let the stylesheet size it to the screen instead.
      el.style.removeProperty('width');
      el.style.removeProperty('height');
    });
  }, [token]);

  return (
    <>
      <section className={styles.ticket} aria-labelledby="pass-name">
        <div className={styles.ticketBar}>
          <span className={styles.dots} aria-hidden="true">
            <span />
            <span />
            <span />
          </span>
          Check-in pass
        </div>
        <div className={styles.ticketBody}>
          <h1 id="pass-name" className={styles.name}>
            {pass.firstName}
          </h1>
          <p className={styles.event}>{pass.event.name}</p>
          <canvas ref={canvas} className={styles.qr} role="img" aria-label="Your check-in QR code" />
          <p className={styles.hint}>Show this at the door. Turn your screen brightness up. This code is personal.</p>
        </div>
        <dl className={styles.facts}>
          <div>
            <dt>When</dt>
            <dd>{formatEventDateTime(pass.event.startsAt, pass.event.timezone)}</dd>
          </div>
          <div>
            <dt>Where</dt>
            <dd>{pass.event.venue}</dd>
          </div>
        </dl>
      </section>
      <PhotoSection pass={pass} token={token} onChanged={onChanged} />
      {/* Keyed so another pass opened in this tab (hash change) never shows the previous pass's setting. */}
      <ProfileSection key={`${token}:${pass.profile.public}`} pass={pass} token={token} />
    </>
  );
}

// SPEC §6.5: opt-in, off by default. The token travels only in the PATCH body (I-3).
function ProfileSection({ pass, token }: { pass: ActivePass; token: string }) {
  const [on, setOn] = useState(pass.profile.public);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null);
  const what = pass.profile.hasLinkedin ? 'name and LinkedIn' : 'name';

  async function onToggle(e: React.ChangeEvent<HTMLInputElement>) {
    const next = e.target.checked;
    setOn(next); // shown at once; put back if the save fails
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch('/api/pass', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token, profilePublic: next }),
      });
      if (res.ok) {
        setMessage({ tone: 'ok', text: next ? 'Your badge profile is shared.' : 'Your badge profile is hidden.' });
      } else {
        setOn(!next);
        setMessage({ tone: 'bad', text: res.status === 429 ? 'Too many attempts. Please wait a minute.' : 'Couldn’t save. Please try again.' });
      }
    } catch {
      setOn(!next);
      setMessage({ tone: 'bad', text: 'Couldn’t save. Check your connection and try again.' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={styles.card} aria-labelledby="profile-heading">
      <h2 id="profile-heading">Badge profile (optional)</h2>
      <p>If you get an NFC badge at the event, other attendees can tap it with their phone.</p>
      <label className={styles.check}>
        <input type="checkbox" checked={on} onChange={onToggle} disabled={busy} />
        Show my {what} when someone taps my badge
      </label>
      {!pass.profile.hasLinkedin && <p className={styles.meta}>We don’t have a LinkedIn URL for you, so only your name would show.</p>}
      <p className={`${styles.message} ${message ? styles[message.tone] : ''}`} role="status" aria-live="polite">
        {message ? `${message.tone === 'ok' ? '✓' : '✕'} ${message.text}` : ''}
      </p>
    </section>
  );
}

function PhotoSection({ pass, token, onChanged }: { pass: ActivePass; token: string; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setBusy(true);
    setMessage(null);
    try {
      let upload: Blob;
      try {
        upload = await shrink(file);
      } catch {
        setMessage({ tone: 'bad', text: "That image couldn't be read. Please use a JPEG, PNG or WebP photo." });
        return;
      }
      const form = new FormData();
      form.set('token', token);
      form.set('file', upload, 'photo.jpg');
      const res = await fetch('/api/pass/photo', { method: 'POST', body: form });
      if (res.ok) {
        setMessage({ tone: 'ok', text: 'Photo saved.' });
        onChanged();
      } else {
        setMessage({ tone: 'bad', text: PHOTO_ERRORS[res.status] ?? 'Upload failed. Please try again.' });
      }
    } catch {
      setMessage({ tone: 'bad', text: 'Upload failed. Check your connection and try again.' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={styles.card} aria-labelledby="photo-heading">
      <h2 id="photo-heading">Photo (optional)</h2>
      <p>A photo helps volunteers check you in faster.</p>
      <div className={styles.photoRow}>
        {pass.photo.url ? (
          <Image className={styles.photo} src={pass.photo.url} alt="Your photo" width={96} height={96} unoptimized />
        ) : (
          <p className={styles.meta}>No photo yet.</p>
        )}
      </div>
      {pass.photoLocked ? (
        <p>🔒 Your photo is locked because you&apos;ve already checked in.</p>
      ) : (
        <>
          <input
            id="photo-input"
            className={styles.fileInput}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            onChange={onFile}
            disabled={busy}
          />
          <label htmlFor="photo-input" className={styles.fileLabel}>
            {busy ? 'Uploading…' : pass.photo.url ? 'Change photo' : 'Add a photo'}
          </label>
        </>
      )}
      <p className={`${styles.message} ${message ? styles[message.tone] : ''}`} role="status" aria-live="polite">
        {message ? `${message.tone === 'ok' ? '✓' : '✕'} ${message.text}` : ''}
      </p>
    </section>
  );
}
