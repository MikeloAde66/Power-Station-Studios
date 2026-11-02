'use client';

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import styles from './page.module.css';

const BONUS_TRACKS = [
  { file: 'westcoast-e.mp3', title: 'Westcoast E' },
  { file: 'spice.mp3', title: 'Spice' },
  { file: 'new-york-vibe-rock.mp3', title: 'New York Vibe Rock' },
];

type Status = 'checking' | 'unlocked' | 'error';

function DownloadInner() {
  const searchParams = useSearchParams();
  const sessionId = searchParams.get('session_id');
  const [status, setStatus] = useState<Status>(sessionId ? 'checking' : 'error');
  const [error, setError] = useState<string | null>(
    sessionId ? null : "No order found. If you just paid, use the link from Stripe's confirmation page."
  );

  useEffect(() => {
    if (!sessionId) return;
    fetch(`/api/verify-purchase?session_id=${encodeURIComponent(sessionId)}`)
      .then(async (res) => {
        const data = await res.json();
        if (res.ok && data.unlocked) {
          setStatus('unlocked');
        } else {
          setStatus('error');
          setError(data.error ?? "Couldn't verify this purchase.");
        }
      })
      .catch(() => {
        setStatus('error');
        setError('Something went wrong verifying your purchase. Refresh to try again.');
      });
  }, [sessionId]);

  return (
    <div className={styles.wrap}>
      <div className={styles.card}>
        <h1 className={styles.title}>POWER TAPE</h1>
        <p className={styles.subtitle}>THANK YOU FOR YOUR PURCHASE</p>

        {status === 'checking' && <p className={styles.status}>Verifying your purchase&hellip;</p>}

        {status === 'error' && <div className={styles.errorBox}>{error}</div>}

        {status === 'unlocked' && (
          <>
            <p className={styles.status}>
              You&rsquo;re unlocked &mdash; file upload, the playlist loader, and your 3 bonus tracks are now
              available on this browser. Download the bonus tracks below, or just head back and load them
              straight into the deck.
            </p>
            <div className={styles.trackList}>
              {BONUS_TRACKS.map((t) => (
                <a key={t.file} className={styles.trackLink} href={`/api/bonus/${t.file}`}>
                  <span>{t.title}</span>
                  <span>&#8681; DOWNLOAD</span>
                </a>
              ))}
            </div>
            <Link href="/" className={styles.backLink}>
              &larr; Back to Power Tape
            </Link>
          </>
        )}
      </div>
    </div>
  );
}

export default function DownloadPage() {
  return (
    <Suspense fallback={null}>
      <DownloadInner />
    </Suspense>
  );
}
