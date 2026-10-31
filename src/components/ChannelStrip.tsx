'use client';

import { useEffect, useRef, useState } from 'react';
import {
  createChannelEngine,
  loadFileIntoEngine,
  playTestTone,
  readLevel,
  setChannelLevel,
  setDrive,
  startBuffer,
  stopSource,
  type ChannelEngine,
  type MasterBus,
} from '@/lib/audioEngine';
import styles from './ChannelStrip.module.css';

type ChannelStripProps = {
  label: string;
  testToneFreq?: number;
  ensureBus: () => MasterBus;
};

export default function ChannelStrip({ label, testToneFreq = 110, ensureBus }: ChannelStripProps) {
  const engineRef = useRef<ChannelEngine | null>(null);
  const rafRef = useRef<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const inputId = `source-file-${label.replace(/\s+/g, '-').toLowerCase()}`;

  const [ready, setReady] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);
  const [drive, setDriveState] = useState(15); // 0-100
  const [level, setLevelState] = useState(80); // 0-100 (channel fader)
  const [meter, setMeter] = useState(0); // 0-1
  const [error, setError] = useState<string | null>(null);

  // Create this channel's engine on first user gesture, attaching it to the
  // shared master bus (created lazily too, by whichever channel goes first).
  function ensureEngine() {
    if (!engineRef.current) {
      const bus = ensureBus();
      const engine = createChannelEngine(bus);
      setDrive(engine, drive / 100);
      setChannelLevel(engine, level / 100);
      engineRef.current = engine;
      setReady(true);
      tick();
    }
    return engineRef.current!;
  }

  function tick() {
    const engine = engineRef.current;
    if (engine) {
      setMeter(readLevel(engine));
    }
    rafRef.current = requestAnimationFrame(tick);
  }

  useEffect(() => {
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      // Don't close the AudioContext here — it's the shared master bus and
      // other channels may still be using it.
    };
  }, []);

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    try {
      const engine = ensureEngine();
      await engine.ctx.resume();
      await loadFileIntoEngine(engine, file);
      setFileName(file.name);
    } catch (err) {
      setError(`Couldn't decode that file: ${(err as Error).message ?? err}`);
    }
  }

  async function handlePlay() {
    setError(null);
    try {
      const engine = ensureEngine();
      await engine.ctx.resume();

      if (engine.ctx.state !== 'running') {
        setError(`AudioContext did not resume (state: ${engine.ctx.state}). Click PLAY again.`);
        return;
      }

      if (fileName && engine.buffer) {
        startBuffer(engine);
      } else {
        // playTestTone starts its own oscillator internally — don't start it again.
        playTestTone(engine, testToneFreq);
      }
      setPlaying(true);
    } catch (err) {
      setError(`Playback failed: ${(err as Error).message ?? err}`);
    }
  }

  function handleStop() {
    const engine = engineRef.current;
    if (engine) stopSource(engine);
    setPlaying(false);
  }

  function handleDriveChange(v: number) {
    setDriveState(v);
    if (engineRef.current) setDrive(engineRef.current, v / 100);
  }

  function handleLevelChange(v: number) {
    setLevelState(v);
    if (engineRef.current) setChannelLevel(engineRef.current, v / 100);
  }

  const driveDb = (drive / 100) * 24; // display-only: 0-24dB of drive
  const levelDb = level <= 0 ? -60 : -60 * (1 - level / 100);
  const meterPct = Math.min(1, meter * 2.4) * 100;

  return (
    <div className={styles.strip}>
      <div className={styles.header}>
        <div className={styles.title}>{label}</div>
        <div className={styles.subtitle}>ANALOG PRE &middot; LIVE</div>
      </div>

      <div className={styles.source}>
        <input
          ref={fileInputRef}
          type="file"
          accept="audio/*"
          onChange={handleFile}
          className={styles.fileInput}
          id={inputId}
        />
        <label htmlFor={inputId} className={styles.fileLabel}>
          {fileName ? fileName : 'Choose audio file…'}
        </label>
        <div className={styles.transport}>
          <button className={styles.btn} onClick={handlePlay} disabled={playing}>
            &#9654; PLAY
          </button>
          <button className={styles.btn} onClick={handleStop} disabled={!playing}>
            &#9632; STOP
          </button>
        </div>
        {!fileName && (
          <div className={styles.hint}>
            No file loaded &mdash; PLAY uses a {testToneFreq}Hz test tone so you can hear the drive stage working.
          </div>
        )}
      </div>

      <div className={styles.meterRow}>
        <div className={styles.meterTrack}>
          <div className={styles.meterFill} style={{ height: `${meterPct}%` }} />
        </div>
        <div className={styles.meterLabel}>LEVEL</div>
      </div>

      <div className={styles.control}>
        <div className={styles.controlHead}>
          <span className={styles.controlName}>DRIVE</span>
          <span className={styles.controlValue}>{driveDb.toFixed(1)} dB</span>
        </div>
        <input
          type="range"
          min={0}
          max={100}
          value={drive}
          onChange={(e) => handleDriveChange(Number(e.target.value))}
          className={styles.slider}
          aria-label="Drive"
        />
      </div>

      <div className={styles.control}>
        <div className={styles.controlHead}>
          <span className={styles.controlName}>CHANNEL</span>
          <span className={styles.controlValue}>{levelDb <= -60 ? '-∞' : levelDb.toFixed(1)} dB</span>
        </div>
        <input
          type="range"
          min={0}
          max={100}
          value={level}
          onChange={(e) => handleLevelChange(Number(e.target.value))}
          className={styles.slider}
          aria-label="Channel level"
        />
      </div>

      {error ? (
        <div className={styles.error}>{error}</div>
      ) : (
        <div className={styles.status}>{ready ? 'ENGINE RUNNING' : 'CLICK PLAY TO START THE AUDIO ENGINE'}</div>
      )}
    </div>
  );
}
