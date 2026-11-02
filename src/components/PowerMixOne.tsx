'use client';

import { useEffect, useRef, useState } from 'react';
import {
  connectMic,
  createChannelEngine,
  createMasterBus,
  disconnectMic,
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
import Knob from './Knob';
import styles from './PowerMixOne.module.css';

// Factory presets: a level-matched drive ladder. Each step pushes DRIVE up by
// X dB and pulls OUTPUT down by the same X dB, so loudness stays roughly
// constant while only the saturation character changes — the standard way
// engineers A/B a drive stage without "louder always sounds better" lying
// to them. The dB steps are a reasonable, usable spread; they are NOT tied
// to any specific hardware brand or measured circuit — this engine runs one
// saturation curve, so a "Neve" or "SSL" label here would claim a character
// difference the DSP doesn't actually produce.
type Preset = { name: string; driveDb: number; outputDb: number };

const PRESETS: Preset[] = [
  { name: 'CLEAN', driveDb: 3.5, outputDb: -3.5 },
  { name: 'TRACKING', driveDb: 5, outputDb: -5 },
  { name: 'PUSH', driveDb: 8, outputDb: -8 },
  { name: 'HOT', driveDb: 10, outputDb: -10 },
  { name: 'HEAVY', driveDb: 12, outputDb: -12 },
];

function driveDbToSlider(db: number) {
  return Math.min(100, Math.max(0, (db / 24) * 100));
}

function outputDbToSlider(db: number) {
  // Inverse of: db = level <= 0 ? -60 : -60 * (1 - level / 100)
  return Math.min(100, Math.max(0, 100 * (1 + db / 60)));
}

type PowerMixOneProps = {
  // When true, the unit renders as a centered overlay (backdrop + close
  // button) instead of an inline block, controlled by `open`. It stays
  // mounted either way — only hidden with CSS — so its engine, knob
  // positions and live state survive being closed and reopened.
  asModal?: boolean;
  open?: boolean;
  onClose?: () => void;
  // Fires whenever the live-signal state changes, so a parent (Power Tape's
  // PRE-AMP button) can show its own green/red status light without
  // reaching into this component's internals.
  onLiveChange?: (live: boolean) => void;
};

export default function PowerMixOne({ asModal = false, open = true, onClose, onLiveChange }: PowerMixOneProps) {
  const busRef = useRef<MasterBus | null>(null);
  const engineRef = useRef<ChannelEngine | null>(null);
  const rafRef = useRef<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [playing, setPlaying] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);
  const [drive, setDriveState] = useState(15); // 0-100
  const [level, setLevelState] = useState(80); // 0-100
  const [meter, setMeter] = useState(0); // 0-1
  const [error, setError] = useState<string | null>(null);
  const [activePreset, setActivePreset] = useState<string | null>(null);
  const [micActive, setMicActive] = useState(false);

  function ensureEngine() {
    if (!engineRef.current) {
      const bus = busRef.current ?? createMasterBus();
      busRef.current = bus;
      const engine = createChannelEngine(bus);
      setDrive(engine, drive / 100);
      setChannelLevel(engine, level / 100);
      engineRef.current = engine;
      tick();
    }
    return engineRef.current!;
  }

  function tick() {
    const engine = engineRef.current;
    if (engine) setMeter(readLevel(engine));
    rafRef.current = requestAnimationFrame(tick);
  }

  useEffect(() => {
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
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
      // A live mic feed and a one-shot file/tone feed both land on the same
      // input stage — pressing PLAY means "play this file", so drop the
      // mic first rather than letting both sources talk at once.
      if (micActive) {
        disconnectMic(engine);
        setMicActive(false);
      }
      await engine.ctx.resume();
      if (fileName && engine.buffer) {
        const node = startBuffer(engine);
        // File no longer loops — when it plays through naturally, flip the
        // UI back to "not playing" instead of leaving PLAY stuck disabled.
        if (node) {
          node.onended = () => setPlaying(false);
        }
      } else {
        playTestTone(engine, 110);
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

  async function handleMicToggle() {
    setError(null);
    try {
      const engine = ensureEngine();
      if (micActive) {
        disconnectMic(engine);
        setMicActive(false);
        return;
      }
      // Live monitoring and file playback both feed the same input stage —
      // stop any file/tone source first so turning MIC on doesn't layer a
      // second signal underneath it.
      stopSource(engine);
      setPlaying(false);
      await engine.ctx.resume();
      await connectMic(engine);
      setMicActive(true);
    } catch (err) {
      setMicActive(false);
      const message = (err as Error)?.message ?? String(err);
      if ((err as Error)?.name === 'NotAllowedError') {
        setError('Mic access was blocked — allow microphone permission for this site and try again.');
      } else if ((err as Error)?.name === 'NotFoundError') {
        setError("No microphone found — check your Scarlett 2i2 is connected and selected as the input.");
      } else {
        setError(`Mic input failed: ${message}`);
      }
    }
  }

  useEffect(() => {
    return () => {
      if (engineRef.current) disconnectMic(engineRef.current);
    };
  }, []);

  // Report live state up to whoever's hosting this (Power Tape's PRE-AMP
  // light) any time it changes, from any source — preset engage, the mic
  // button, or an error that knocked it back off.
  useEffect(() => {
    onLiveChange?.(micActive);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [micActive]);

  function handleDriveChange(v: number) {
    setDriveState(v);
    setActivePreset(null);
    if (engineRef.current) setDrive(engineRef.current, v / 100);
  }

  function handleLevelChange(v: number) {
    setLevelState(v);
    setActivePreset(null);
    if (engineRef.current) setChannelLevel(engineRef.current, v / 100);
  }

  // Picking a preset is the "turn the preamp on" gesture — most engineers
  // dial in a character once (e.g. TRACKING) and never touch it again, so
  // selecting one both sets the sound AND engages live input monitoring.
  // Clicking the already-active preset again is the off switch: the light
  // goes from green to red and monitoring stops, same knob settings held
  // underneath for whenever it's turned back on.
  async function applyPreset(preset: Preset) {
    setError(null);
    const engine = ensureEngine();

    if (activePreset === preset.name && micActive) {
      disconnectMic(engine);
      setMicActive(false);
      return;
    }

    const driveSlider = driveDbToSlider(preset.driveDb);
    const outputSlider = outputDbToSlider(preset.outputDb);
    setDriveState(driveSlider);
    setLevelState(outputSlider);
    setActivePreset(preset.name);
    setDrive(engine, driveSlider / 100);
    setChannelLevel(engine, outputSlider / 100);

    if (!micActive) {
      try {
        stopSource(engine);
        setPlaying(false);
        await engine.ctx.resume();
        await connectMic(engine);
        setMicActive(true);
      } catch (err) {
        setMicActive(false);
        const name = (err as Error)?.name;
        if (name === 'NotAllowedError') {
          setError('Mic access was blocked — allow microphone permission for this site and try again.');
        } else if (name === 'NotFoundError') {
          setError("No microphone found — check your Scarlett 2i2 is connected and selected as the input.");
        } else {
          setError(`Mic input failed: ${(err as Error)?.message ?? err}`);
        }
      }
    }
  }

  const driveDb = (drive / 100) * 24;
  const levelDb = level <= 0 ? -60 : -60 * (1 - level / 100);
  const meterPct = Math.min(1, meter * 2.4) * 100;

  const unit = (
    <div className={styles.frame}>
      <div className={styles.rivet} data-pos="tl" />
      <div className={styles.rivet} data-pos="tr" />
      <div className={styles.rivet} data-pos="bl" />
      <div className={styles.rivet} data-pos="br" />

      <div className={styles.header}>
        <div className={styles.headerLeft}>
          <div className={styles.wordmark}>POWER MIX ONE</div>
          <div className={styles.liveLamp} title={micActive ? 'Live' : 'Off'}>
            <span className={`${styles.liveDot} ${micActive ? styles.liveDotOn : styles.liveDotOff}`} />
            <span className={styles.liveLabel}>{micActive ? 'LIVE' : 'OFF'}</span>
          </div>
        </div>
        <div className={styles.transportMini}>
          {asModal && (
            <button className={styles.iconBtn} onClick={onClose} title="Close">
              &#10005;
            </button>
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept="audio/*"
            onChange={handleFile}
            className={styles.fileInput}
            id="pmo-upload"
          />
          <label htmlFor="pmo-upload" className={styles.iconBtn} title="Load audio">
            &rsaquo;&rsaquo;&rsaquo;
          </label>
          <button className={styles.iconBtn} onClick={handlePlay} disabled={playing} title="Play">
            &#9654;
          </button>
          <button className={styles.iconBtn} onClick={handleStop} disabled={!playing} title="Stop">
            &#9632;
          </button>
          <button
            className={`${styles.iconBtn} ${micActive ? styles.micActive : ''}`}
            onClick={handleMicToggle}
            title={micActive ? 'Stop live mic monitoring' : 'Monitor live mic input (e.g. Scarlett 2i2)'}
          >
            &#9679;
          </button>
        </div>
      </div>

      <div className={styles.body}>
        <Knob
          label="DRIVE"
          value={drive}
          onChange={handleDriveChange}
          valueLabel={`${driveDb.toFixed(1)} dB`}
          color="red"
          size={160}
        />

        <div className={styles.meterTrack}>
          <div className={styles.meterFill} style={{ height: `${meterPct}%` }} />
        </div>

        <Knob
          label="OUTPUT"
          value={level}
          onChange={handleLevelChange}
          valueLabel={levelDb <= -60 ? '-∞' : `${levelDb.toFixed(1)} dB`}
          color="white"
          size={160}
        />
      </div>

      <div className={styles.presetRow}>
        {PRESETS.map((preset) => (
          <button
            key={preset.name}
            className={`${styles.presetBtn} ${activePreset === preset.name ? styles.presetActive : ''}`}
            onClick={() => applyPreset(preset)}
          >
            {preset.name}
          </button>
        ))}
      </div>

      {error && <div className={styles.error}>{error}</div>}
    </div>
  );

  if (!asModal) return unit;

  return (
    <div
      className={`${styles.modalBackdrop} ${open ? styles.modalBackdropOpen : ''}`}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose?.();
      }}
    >
      <div className={styles.modalShell}>{unit}</div>
    </div>
  );
}
