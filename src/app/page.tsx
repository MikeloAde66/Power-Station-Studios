'use client';

import { useState } from 'react';
import PowerDynamics from '@/components/PowerDynamics';
import PowerMixOne from '@/components/PowerMixOne';
import PowerTape from '@/components/PowerTape';
import styles from './page.module.css';

// The preamp lives inside Power Tape's world now — Tape is the thing people
// see first; the preamp only appears when they ask for it via the PRE-AMP
// button, and stays mounted (not destroyed) behind the scenes so its knob
// positions and live state survive being closed and reopened.
export default function Home() {
  const [preampOpen, setPreampOpen] = useState(false);
  const [preampLive, setPreampLive] = useState(false);

  return (
    <div className={styles.page}>
      <main className={styles.main}>
        <PowerDynamics />
        <PowerTape onOpenPreamp={() => setPreampOpen(true)} preampLive={preampLive} />
      </main>
      <PowerMixOne
        asModal
        open={preampOpen}
        onClose={() => setPreampOpen(false)}
        onLiveChange={setPreampLive}
      />
    </div>
  );
}
