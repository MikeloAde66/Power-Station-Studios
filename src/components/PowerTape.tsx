'use client';

import Image from 'next/image';
import { useEffect, useRef, useState } from 'react';
import {
  connectMic,
  createMasterBus,
  createTapeEngine,
  disconnectMic,
  loadFileIntoEngine,
  playTestTone,
  readLevel,
  setTapeDrive,
  setTapeNoiseLevel,
  setTapeOutputLevel,
  setWowFlutterDepth,
  startBuffer,
  stopSource,
  type MasterBus,
  type TapeEngine,
} from '@/lib/audioEngine';
import Knob from './Knob';
import VUMeter from './VUMeter';
import styles from './PowerTape.module.css';

// Real tape-character presets (drive/wobble/noise/output) — named for what
// they sound like, not borrowed from any real machine or manufacturer.
type Preset = { name: string; drive: number; wobble: number; noise: number; output: number };

const PRESETS: Preset[] = [
  { name: 'CLEAN TAPE', drive: 10, wobble: 5, noise: 5, output: 80 },
  { name: 'WARM TAPE', drive: 35, wobble: 15, noise: 15, output: 75 },
  { name: 'VINTAGE WOBBLE', drive: 45, wobble: 55, noise: 25, output: 70 },
  { name: 'LO-FI CASSETTE', drive: 55, wobble: 40, noise: 45, output: 65 },
  { name: 'DESTROYED', drive: 85, wobble: 80, noise: 70, output: 55 },
];

function formatCounter(seconds: number) {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export default function PowerTape() {
  const busRef = useRef<MasterBus | null>(null);
  const engineRef = useRef<TapeEngine | null>(null);
  const rafRef = useRef<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const startCtxTimeRef = useRef<number | null>(null);

  const [playing, setPlaying] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);
  const [drive, setDriveState] = useState(35);
  const [wobble, setWobble] = useState(15);
  const [noise, setNoise] = useState(15);
  const [output, setOutput] = useState(75);
  const [meter, setMeter] = useState(0);
  const [elapsedSec, setElapsedSec] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [activePreset, setActivePreset] = useState<string | null>('WARM TAPE');
  const [micActive, setMicActive] = useState(false);

  function ensureEngine() {
    if (!engineRef.current) {
      const bus = busRef.current ?? createMasterBus();
      busRef.current = bus;
      const engine = createTapeEngine(bus);
      setTapeDrive(engine, drive / 100);
      setWowFlutterDepth(engine, wobble / 100);
      setTapeNoiseLevel(engine, noise / 100);
      setTapeOutputLevel(engine, output / 100);
      engineRef.current = engine;
      tick();
    }
    return engineRef.current!;
  }

  function tick() {
    const engine = engineRef.current;
    if (engine) {
      setMeter(readLevel(engine));
      if (startCtxTimeRef.current !== null) {
        setElapsedSec(engine.ctx.currentTime - startCtxTimeRef.current);
      }
    }
    rafRef.current = requestAnimationFrame(tick);
  }

  useEffect(() => {
    ensureEngine();
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      if (engineRef.current) disconnectMic(engineRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
      if (micActive) {
        disconnectMic(engine);
        setMicActive(false);
      }
      await engine.ctx.resume();
      if (fileName && engine.buffer) {
        const node = startBuffer(engine);
        if (node) {
          node.onended = () => {
            setPlaying(false);
            startCtxTimeRef.current = null;
            setElapsedSec(0);
          };
        }
      } else {
        playTestTone(engine, 165);
      }
      startCtxTimeRef.current = engine.ctx.currentTime;
      setElapsedSec(0);
      setPlaying(true);
    } catch (err) {
      setError(`Playback failed: ${(err as Error).message ?? err}`);
    }
  }

  function handleStop() {
    const engine = engineRef.current;
    if (engine) stopSource(engine);
    setPlaying(false);
    startCtxTimeRef.current = null;
    setElapsedSec(0);
  }

  async function handleMicToggle() {
    setError(null);
    try {
      const engine = ensureEngine();
      if (micActive) {
        disconnectMic(engine);
        setMicActive(false);
        startCtxTimeRef.current = null;
        setElapsedSec(0);
        return;
      }
      stopSource(engine);
      setPlaying(false);
      await engine.ctx.resume();
      await connectMic(engine);
      startCtxTimeRef.current = engine.ctx.currentTime;
      setElapsedSec(0);
      setMicActive(true);
    } catch (err) {
      setMicActive(false);
      const name = (err as Error)?.name;
      if (name === 'NotAllowedError') {
        setError('Mic access was blocked — allow microphone permission for this site and try again.');
      } else if (name === 'NotFoundError') {
        setError('No microphone found — check your audio interface is connected and selected as the input.');
      } else {
        setError(`Mic input failed: ${(err as Error)?.message ?? err}`);
      }
    }
  }

  function handleDriveChange(v: number) {
    setDriveState(v);
    setActivePreset(null);
    if (engineRef.current) setTapeDrive(engineRef.current, v / 100);
  }

  function handleWobbleChange(v: number) {
    setWobble(v);
    setActivePreset(null);
    if (engineRef.current) setWowFlutterDepth(engineRef.current, v / 100);
  }

  function handleNoiseChange(v: number) {
    setNoise(v);
    setActivePreset(null);
    if (engineRef.current) setTapeNoiseLevel(engineRef.current, v / 100);
  }

  function handleOutputChange(v: number) {
    setOutput(v);
    setActivePreset(null);
    if (engineRef.current) setTapeOutputLevel(engineRef.current, v / 100);
  }

  function applyPreset(preset: Preset) {
    setDriveState(preset.drive);
    setWobble(preset.wobble);
    setNoise(preset.noise);
    setOutput(preset.output);
    setActivePreset(preset.name);
    const engine = engineRef.current;
    if (engine) {
      setTapeDrive(engine, preset.drive / 100);
      setWowFlutterDepth(engine, preset.wobble / 100);
      setTapeNoiseLevel(engine, preset.noise / 100);
      setTapeOutputLevel(engine, preset.output / 100);
    }
  }

  function handlePresetSelect(e: React.ChangeEvent<HTMLSelectElement>) {
    const preset = PRESETS.find((p) => p.name === e.target.value);
    if (preset) applyPreset(preset);
  }

  const outputDb = output <= 0 ? -60 : -60 * (1 - output / 100);
  const spinning = playing || micActive;

  return (
    <div className={styles.frame}>
      <div className={styles.screw} data-pos="tl" />
      <div className={styles.screw} data-pos="tr" />
      <div className={styles.screw} data-pos="bl" />
      <div className={styles.screw} data-pos="br" />

      <div className={styles.header}>
        <div className={styles.wordmark}>POWER TAPE</div>
        <input
          ref={fileInputRef}
          type="file"
          accept="audio/*"
          onChange={handleFile}
          className={styles.fileInput}
          id="pt-upload"
        />
        <label htmlFor="pt-upload" className={styles.uploadBtn} title="Load audio">
          &rsaquo;&rsaquo;&rsaquo; LOAD
        </label>
      </div>

      <div className={styles.transportDeck}>
        <div className={`${styles.reel} ${spinning ? styles.spinning : ''}`}>
          <Image src="/tape/reel-full.png" alt="" fill sizes="220px" className={styles.reelImg} priority />
        </div>

        <div className={styles.tapePath}>
          <div className={`${styles.tapeStrand} ${styles.tapeStrandLeft}`} />
          <div className={styles.headBlock}>
            <div className={styles.headGap} />
            <div className={styles.headGap} />
            <div className={styles.headGap} />
          </div>
          <div className={`${styles.tapeStrand} ${styles.tapeStrandRight}`} />
        </div>

        <div className={`${styles.reel} ${spinning ? styles.spinning : ''}`}>
          <Image src="/tape/reel-takeup-v2.png" alt="" fill sizes="220px" className={styles.reelImg} priority />
        </div>
      </div>

      <div className={styles.controlPanel}>
        <div className={styles.controlRow}>
          <VUMeter level01={meter} faceColor="#ead9b0" needleColor="#2a1c0a" scaleColor="#4a3516" width={140} />
          <Knob label="DRIVE" value={drive} onChange={handleDriveChange} valueLabel={`${drive.toFixed(0)}%`} color="brass" size={66} />
          <Knob label="WOW/FLUTTER" value={wobble} onChange={handleWobbleChange} valueLabel={`${wobble.toFixed(0)}%`} color="brass" size={66} />
          <Knob label="NOISE" value={noise} onChange={handleNoiseChange} valueLabel={`${noise.toFixed(0)}%`} color="brass" size={66} />
          <Knob
            label="OUTPUT"
            value={output}
            onChange={handleOutputChange}
            valueLabel={outputDb <= -60 ? '-∞' : `${outputDb.toFixed(1)} dB`}
            color="brass"
            size={66}
          />
        </div>

        <div className={styles.controlRow}>
          <select className={styles.presetSelect} value={activePreset ?? ''} onChange={handlePresetSelect}>
            {!activePreset && <option value="">CUSTOM</option>}
            {PRESETS.map((p) => (
              <option key={p.name} value={p.name}>
                {p.name}
              </option>
            ))}
          </select>

          <div className={styles.transportGroup}>
            <button className={styles.transportBtn} onClick={handlePlay} disabled={playing} title="Play">
              &#9654;
            </button>
            <button className={styles.transportBtn} onClick={handleStop} disabled={!playing} title="Stop">
              &#9632;
            </button>
            <button
              className={`${styles.transportBtn} ${micActive ? styles.micActive : ''}`}
              onClick={handleMicToggle}
              title={micActive ? 'Stop live mic monitoring' : 'Monitor live mic input'}
            >
              &#9679;
            </button>
          </div>

          <div className={styles.counter}>
            <span className={styles.counterLabel}>COUNTER</span>
            <span className={styles.counterDigits}>{formatCounter(elapsedSec)}</span>
          </div>
        </div>
      </div>

      {error && <div className={styles.error}>{error}</div>}
    </div>
  );
}
