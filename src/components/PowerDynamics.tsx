'use client';

import { useEffect, useRef, useState } from 'react';
import {
  connectMic,
  createDynamicsEngine,
  createMasterBus,
  disconnectMic,
  loadFileIntoEngine,
  playTestTone,
  readGainReduction,
  readLevel,
  setCompAttack,
  setCompRatio,
  setCompRelease,
  setCompThreshold,
  setDynOutputLevel,
  setLimiterCeiling,
  startBuffer,
  stopSource,
  type DynamicsEngine,
  type MasterBus,
} from '@/lib/audioEngine';
import Knob from './Knob';
import VUMeter from './VUMeter';
import styles from './PowerDynamics.module.css';

// Factory presets: real compressor/limiter settings (threshold, ratio,
// attack, release, limiter ceiling) tuned for recognizable use cases —
// NOT named after, or claiming to model, any specific real console or
// engineer. One squeeze knob drives threshold+ratio together so the
// control stays as simple as Power Mix One's; attack/release/ceiling ride
// along underneath per preset, same as a real strip's "character" switch.
type Preset = {
  name: string;
  squeeze: number; // 0-100, maps to threshold+ratio together
  output: number; // 0-100
  attackMs: number;
  releaseMs: number;
  ceilingDb: number;
};

const PRESETS: Preset[] = [
  { name: 'TRANSPARENT', squeeze: 20, output: 75, attackMs: 20, releaseMs: 250, ceilingDb: -1 },
  { name: 'VOCAL GLUE', squeeze: 45, output: 70, attackMs: 10, releaseMs: 200, ceilingDb: -1 },
  { name: 'DRUM PUNCH', squeeze: 55, output: 68, attackMs: 3, releaseMs: 150, ceilingDb: -0.5 },
  { name: 'BUS GLUE', squeeze: 35, output: 72, attackMs: 30, releaseMs: 400, ceilingDb: -1 },
  { name: 'BRICK LIMIT', squeeze: 65, output: 60, attackMs: 1, releaseMs: 100, ceilingDb: -0.3 },
];

function squeezeToThreshold(squeeze01: number) {
  return -6 - squeeze01 * 30; // -6dB (barely squeezing) down to -36dB (hard)
}

function squeezeToRatio(squeeze01: number) {
  return 1.5 + squeeze01 * 8.5; // 1.5:1 up to 10:1
}

export default function PowerDynamics() {
  const busRef = useRef<MasterBus | null>(null);
  const engineRef = useRef<DynamicsEngine | null>(null);
  const rafRef = useRef<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [playing, setPlaying] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);
  const [squeeze, setSqueeze] = useState(35); // 0-100
  const [output, setOutput] = useState(72); // 0-100
  const [meter, setMeter] = useState(0); // 0-1 signal
  const [gr, setGr] = useState(0); // 0-1 gain reduction
  const [error, setError] = useState<string | null>(null);
  const [activePreset, setActivePreset] = useState<string | null>('BUS GLUE');
  const [micActive, setMicActive] = useState(false);

  function ensureEngine() {
    if (!engineRef.current) {
      const bus = busRef.current ?? createMasterBus();
      busRef.current = bus;
      const engine = createDynamicsEngine(bus);
      setCompThreshold(engine, squeezeToThreshold(squeeze / 100));
      setCompRatio(engine, squeezeToRatio(squeeze / 100));
      setDynOutputLevel(engine, output / 100);
      engineRef.current = engine;
    }
    return engineRef.current!;
  }

  function tick() {
    const engine = engineRef.current;
    if (engine) {
      setMeter(readLevel(engine));
      setGr(Math.min(1, Math.abs(readGainReduction(engine)) / 24));
    }
    rafRef.current = requestAnimationFrame(tick);
  }

  useEffect(() => {
    // Apply the default preset's attack/release/ceiling once the engine exists.
    const engine = ensureEngine();
    const preset = PRESETS.find((p) => p.name === activePreset);
    if (preset) {
      setCompAttack(engine, preset.attackMs / 1000);
      setCompRelease(engine, preset.releaseMs / 1000);
      setLimiterCeiling(engine, preset.ceilingDb);
    }
    // Started here (not inside ensureEngine) so the meter/GR loop is
    // re-armed on every effect run, including React StrictMode's
    // dev-mode mount -> cleanup -> mount cycle, which would otherwise
    // cancel the one scheduled frame from ensureEngine's one-time setup
    // and leave the loop permanently stopped.
    rafRef.current = requestAnimationFrame(tick);
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
        if (node) node.onended = () => setPlaying(false);
      } else {
        playTestTone(engine, 220);
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
        setError('No microphone found — check your audio interface is connected and selected as the input.');
      } else {
        setError(`Mic input failed: ${(err as Error)?.message ?? err}`);
      }
    }
  }

  function handleSqueezeChange(v: number) {
    setSqueeze(v);
    setActivePreset(null);
    const engine = engineRef.current;
    if (engine) {
      setCompThreshold(engine, squeezeToThreshold(v / 100));
      setCompRatio(engine, squeezeToRatio(v / 100));
    }
  }

  function handleOutputChange(v: number) {
    setOutput(v);
    setActivePreset(null);
    if (engineRef.current) setDynOutputLevel(engineRef.current, v / 100);
  }

  function applyPreset(preset: Preset) {
    setSqueeze(preset.squeeze);
    setOutput(preset.output);
    setActivePreset(preset.name);
    const engine = engineRef.current;
    if (engine) {
      setCompThreshold(engine, squeezeToThreshold(preset.squeeze / 100));
      setCompRatio(engine, squeezeToRatio(preset.squeeze / 100));
      setDynOutputLevel(engine, preset.output / 100);
      setCompAttack(engine, preset.attackMs / 1000);
      setCompRelease(engine, preset.releaseMs / 1000);
      setLimiterCeiling(engine, preset.ceilingDb);
    }
  }

  const thresholdDb = squeezeToThreshold(squeeze / 100);
  const ratio = squeezeToRatio(squeeze / 100);
  const outputDb = output <= 0 ? -60 : -60 * (1 - output / 100);
  const grPct = gr * 100;

  return (
    <div className={styles.frame}>
      <div className={styles.rivet} data-pos="tl" />
      <div className={styles.rivet} data-pos="tr" />
      <div className={styles.rivet} data-pos="bl" />
      <div className={styles.rivet} data-pos="br" />

      <div className={styles.header}>
        <div className={styles.wordmark}>POWER DYNAMICS</div>
        <div className={styles.transportMini}>
          <input
            ref={fileInputRef}
            type="file"
            accept="audio/*"
            onChange={handleFile}
            className={styles.fileInput}
            id="pd-upload"
          />
          <label htmlFor="pd-upload" className={styles.iconBtn} title="Load audio">
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
            title={micActive ? 'Stop live mic monitoring' : 'Monitor live mic input'}
          >
            &#9679;
          </button>
        </div>
      </div>

      <div className={styles.body}>
        <Knob
          label="SQUEEZE"
          value={squeeze}
          onChange={handleSqueezeChange}
          valueLabel={`${thresholdDb.toFixed(0)}dB ${ratio.toFixed(1)}:1`}
          color="chrome"
          size={130}
        />

        <div className={styles.meterStack}>
          <VUMeter level01={meter} faceColor="#d9a63a" needleColor="#1a1208" scaleColor="#3a2409" width={210} />
          <div className={styles.grRow}>
            <span className={styles.grCaption}>GR</span>
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className={styles.grLed} data-lit={grPct / 100 >= (i + 1) / 8} data-hot={i >= 6} />
            ))}
          </div>
        </div>

        <Knob
          label="OUTPUT"
          value={output}
          onChange={handleOutputChange}
          valueLabel={outputDb <= -60 ? '-∞' : `${outputDb.toFixed(1)} dB`}
          color="chrome"
          size={130}
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
}
