'use client';

import { useRef, useState } from 'react';
import ChannelStrip from './ChannelStrip';
import MasterFader from './MasterFader';
import { createMasterBus, type MasterBus } from '@/lib/audioEngine';
import styles from './Console.module.css';

export default function Console() {
  const busRef = useRef<MasterBus | null>(null);
  const [bus, setBus] = useState<MasterBus | null>(null);

  // Lazily creates the shared master bus on the first user gesture, from
  // whichever channel the person interacts with first.
  function ensureBus(): MasterBus {
    if (!busRef.current) {
      const newBus = createMasterBus();
      busRef.current = newBus;
      setBus(newBus);
    }
    return busRef.current;
  }

  return (
    <div className={styles.console}>
      <ChannelStrip label="CH 1" testToneFreq={110} ensureBus={ensureBus} />
      <ChannelStrip label="CH 2" testToneFreq={165} ensureBus={ensureBus} />
      <MasterFader bus={bus} />
    </div>
  );
}
