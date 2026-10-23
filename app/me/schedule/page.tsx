import type { Metadata } from 'next';
import Link from 'next/link';
import styles from '../../profile/[uid]/profile.module.css';
import me from '../me.module.css';
import { loadMyEvent, menuMetadata } from '../load';

export const metadata: Metadata = menuMetadata('Schedule');

// SPEC F14: the schedule organizers type on the admin Info page (plain text, rendered escaped).
export default async function SchedulePage() {
  const { me: m } = await loadMyEvent('/me/schedule');
  return (
    <main className={styles.page}>
      <div className={styles.top}>
        <Link className={me.back} href="/me">
          ← Menu
        </Link>
        <span className={styles.context}>{m.event.name}</span>
      </div>
      <h1>Schedule</h1>
      <section className={styles.card}>
        <p className={me.text}>{m.event.schedule || 'The organizers haven’t posted the schedule yet.'}</p>
      </section>
    </main>
  );
}
