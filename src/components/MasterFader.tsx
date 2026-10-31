'use client';

import { useEffect, useRef, useState } from 'react';
import { readBusLevel, setMasterLevel, type MasterBus } from '@/lib/audioEngine';
import styles from './ChannelStrip.module.css';
import masterStyles from './MasterFader.module.css';

type MasterFaderProps = {
  bus: MasterBus | null;
};

export default function MasterFader({ bus }: MasterFaderProps) {
  const rafRef = useRef<number | null>(null);
  const [level, setLevelState] = useState(80); // 0-100
  const [meter, setMeter] = useState(0); // 0-1

  useEffect(() => {
    function tick() {
      if (bus) setMeter(readBusLevel(bus));
      rafRef.current = requestAnimationFrame(tick);
    }
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [bus]);

  function handleLevelChange(v: number) {
    setLevelState(v);
    if (bus) setMasterLevel(bus, v / 100);
  }

  const levelDb = level <= 0 ? -60 : -60 * (1 - level / 100);
  const meterPct = Math.min(1, meter * 2.4) * 100;

  return (
    <div className={`${styles.strip} ${masterStyles.master}`}>
      <div className={styles.header}>
        <div className={styles.title}>MASTER</div>
        <div className={styles.subtitle}>OUTPUT BUS</div>
      </div>

      <div className={masterStyles.spacer} />

      <div className={styles.meterRow}>
        <div className={styles.meterTrack}>
          <div className={styles.meterFill} style={{ height: `${meterPct}%` }} />
        </div>
        <div className={styles.meterLabel}>LEVEL</div>
      </div>

      <div className={styles.control}>
        <div className={styles.controlHead}>
          <span className={styles.controlName}>MASTER</span>
          <span className={styles.controlValue}>{levelDb <= -60 ? '-∞' : levelDb.toFixed(1)} dB</span>
        </div>
        <input
          type="range"
          min={0}
          max={100}
          value={level}
          onChange={(e) => handleLevelChange(Number(e.target.value))}
          className={styles.slider}
          aria-label="Master level"
        />
      </div>

      <div className={styles.status}>{bus ? 'BUS ACTIVE' : 'WAITING ON FIRST CHANNEL'}</div>
    </div>
  );
}
