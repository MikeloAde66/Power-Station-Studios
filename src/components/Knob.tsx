'use client';

import { useCallback, useRef } from 'react';
import styles from './Knob.module.css';

type KnobProps = {
  label: string;
  value: number; // 0-100
  onChange: (v: number) => void;
  valueLabel: string;
  color?: 'red' | 'white' | 'chrome' | 'brass';
  size?: number; // px
};

const MIN_DEG = -135;
const MAX_DEG = 135;
const SWEEP = MAX_DEG - MIN_DEG;
const SENSITIVITY = 0.5; // px of vertical drag per 1 unit of value

export default function Knob({ label, value, onChange, valueLabel, color = 'white', size = 150 }: KnobProps) {
  const dragState = useRef<{ startY: number; startValue: number } | null>(null);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      dragState.current = { startY: e.clientY, startValue: value };
    },
    [value]
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!dragState.current) return;
      const deltaY = dragState.current.startY - e.clientY; // dragging up increases value
      const next = Math.min(100, Math.max(0, dragState.current.startValue + deltaY * SENSITIVITY));
      onChange(next);
    },
    [onChange]
  );

  const handlePointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    dragState.current = null;
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      // already released — fine
    }
  }, []);

  function handleWheel(e: React.WheelEvent<HTMLDivElement>) {
    const next = Math.min(100, Math.max(0, value - e.deltaY * 0.1));
    onChange(next);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key === 'ArrowUp' || e.key === 'ArrowRight') {
      onChange(Math.min(100, value + 2));
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') {
      onChange(Math.max(0, value - 2));
    }
  }

  const deg = MIN_DEG + (value / 100) * SWEEP;

  return (
    <div className={styles.knobWrap} style={{ width: size }}>
      <div
        className={`${styles.knob} ${styles[color]}`}
        style={{ width: size, height: size }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onWheel={handleWheel}
        onKeyDown={handleKeyDown}
        tabIndex={0}
        role="slider"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(value)}
      >
        <div className={styles.indicator} style={{ transform: `rotate(${deg}deg)` }} />
        <div className={styles.cap} />
      </div>
      <div className={styles.label}>{label}</div>
      <div className={styles.value}>{valueLabel}</div>
    </div>
  );
}
