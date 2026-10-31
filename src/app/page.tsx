import Console from '@/components/Console';
import styles from './page.module.css';

export default function Home() {
  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.wordmark}>POWER MIX ONE</h1>
        <p className={styles.tagline}>
          Milestone 2: two channels feeding one shared master bus. Load CH1 and CH2 independently,
          push DRIVE on each, then ride the MASTER fader &mdash; this is the real signal-flow
          skeleton the rest of the console gets built on.
        </p>
      </header>
      <main className={styles.main}>
        <Console />
      </main>
    </div>
  );
}
