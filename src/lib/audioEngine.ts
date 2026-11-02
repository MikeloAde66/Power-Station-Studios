// Power Mix One — audio engine.
//
// Topology (Milestone 2): a shared master bus, fed by any number of channel
// strips. Each channel does its own drive/saturation, then lands on the
// master bus, which sums everything and applies one final fader before the
// speakers — exactly how a real console's channel faders feed the master
// bus instead of their own separate outputs.
//
//   CH1: source -> inputGain -> shaper -> channelGain -> channel analyser ---\
//   CH2: source -> inputGain -> shaper -> channelGain -> channel analyser ---+--> masterGain -> master analyser -> speakers
//   (future channels join the same way)                                    -/

export type MasterBus = {
  ctx: AudioContext;
  masterGain: GainNode;
  analyser: AnalyserNode;
};

// Shared shape for anything that can load a file, play a test tone, or
// monitor a live mic — a channel strip, a dynamics module, a delay, etc.
// ChannelEngine and DynamicsEngine both satisfy this structurally, so the
// transport/mic functions below work for either without duplication.
export type AudioStage = {
  ctx: AudioContext;
  sourceNode: AudioBufferSourceNode | OscillatorNode | null;
  buffer: AudioBuffer | null;
  inputGain: GainNode;
  micNode: MediaStreamAudioSourceNode | null;
  micStream: MediaStream | null;
};

export type ChannelEngine = AudioStage & {
  shaper: WaveShaperNode;
  channelGain: GainNode;
  analyser: AnalyserNode;
};

// Builds a soft-saturation transfer curve. `amount` is 0..1 (the DRIVE knob).
// tanh gives a graceful, rounded knee instead of a hard digital clip; the
// squared term adds a touch of even-order (asymmetric) harmonic content,
// which is what reads as "warm" rather than just "quieter and squashed."
//
// A preamp's job is subtle coloration across most of its travel — real grit
// is a special-occasion thing (ear candy on a snare, not a default), not
// what you want by mid-knob. So the amount-to-drive mapping is backloaded
// (amount^1.8) rather than linear: the first ~60% of the knob stays in warm,
// usable territory, and the curve only opens up into real saturation in the
// last third of the range.
export function makeSaturationCurve(amount: number): Float32Array<ArrayBuffer> {
  const n = 2048;
  const curve = new Float32Array(n);
  const shaped01 = Math.pow(amount, 1.8); // backloaded response curve
  const drive = 1 + shaped01 * 10; // 1x (clean) up to 11x (hot) pre-gain into the curve, only at the top of the knob
  const norm = Math.tanh(drive) || 1;
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    const wet = Math.tanh(drive * x + 0.12 * amount * x * x) / norm;
    // Crossfade dry (true identity, x) toward the saturated curve as amount
    // rises. At amount = 0 this is EXACTLY y = x — a real bypass, not just a
    // very mild curve — so DRIVE fully down adds zero coloration and zero
    // noise-floor lift, the way a clean preamp stage should behave at unity.
    curve[i] = amount <= 0 ? x : wet * amount + x * (1 - amount);
  }
  return curve;
}

export function createMasterBus(): MasterBus {
  const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const ctx = new AC();

  const masterGain = ctx.createGain();
  masterGain.gain.value = 0.8;

  const analyser = ctx.createAnalyser();
  analyser.fftSize = 1024;
  analyser.smoothingTimeConstant = 0.75;

  masterGain.connect(analyser);
  analyser.connect(ctx.destination);

  return { ctx, masterGain, analyser };
}

export function setMasterLevel(bus: MasterBus, amount01: number) {
  // 0..1 maps to -60dB..0dB, matching the fader's printed scale.
  const db = amount01 <= 0 ? -60 : -60 * (1 - amount01);
  const gain = Math.pow(10, db / 20);
  bus.masterGain.gain.setTargetAtTime(gain, bus.ctx.currentTime, 0.01);
}

export function readBusLevel(bus: MasterBus): number {
  return readAnalyserLevel(bus.analyser);
}

export function createChannelEngine(bus: MasterBus): ChannelEngine {
  const ctx = bus.ctx;

  const inputGain = ctx.createGain();
  inputGain.gain.value = 1;

  const shaper = ctx.createWaveShaper();
  shaper.curve = makeSaturationCurve(0.15);
  shaper.oversample = '4x';

  const channelGain = ctx.createGain();
  channelGain.gain.value = 0.8;

  const analyser = ctx.createAnalyser();
  analyser.fftSize = 1024;
  analyser.smoothingTimeConstant = 0.75;

  inputGain.connect(shaper);
  shaper.connect(channelGain);
  channelGain.connect(analyser);
  analyser.connect(bus.masterGain);

  return { ctx, sourceNode: null, buffer: null, inputGain, shaper, channelGain, analyser, micNode: null, micStream: null };
}

// Live mic input — raw/unprocessed so the browser's own echo cancellation,
// noise suppression, and auto-gain don't fight with (or mask) what the
// preamp stage is actually doing to the signal.
export async function connectMic(engine: AudioStage): Promise<void> {
  disconnectMic(engine);
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
    },
  });
  const node = engine.ctx.createMediaStreamSource(stream);
  node.connect(engine.inputGain);
  engine.micStream = stream;
  engine.micNode = node;
}

export function disconnectMic(engine: AudioStage) {
  if (engine.micNode) {
    engine.micNode.disconnect();
    engine.micNode = null;
  }
  if (engine.micStream) {
    engine.micStream.getTracks().forEach((track) => track.stop());
    engine.micStream = null;
  }
}

export function setDrive(engine: ChannelEngine, amount01: number) {
  engine.shaper.curve = makeSaturationCurve(amount01);
  // A little extra input gain as drive increases, so pushing DRIVE actually
  // pushes the curve instead of just resting at a louder clean level. Kept
  // modest (vs. the old 2.2x) so this reads as "the color stage working,"
  // not just "it got louder" stacked on top of the curve's own saturation.
  engine.inputGain.gain.setTargetAtTime(1 + amount01 * 1.2, engine.ctx.currentTime, 0.01);
}

export function setChannelLevel(engine: ChannelEngine, amount01: number) {
  // 0..1 maps to -60dB..0dB, matching the fader's printed scale.
  const db = amount01 <= 0 ? -60 : -60 * (1 - amount01);
  const gain = Math.pow(10, db / 20);
  engine.channelGain.gain.setTargetAtTime(gain, engine.ctx.currentTime, 0.01);
}

// Decodes the file ONCE and stores the resulting AudioBuffer on the engine.
// Does not create or start a playback node — call startBuffer() for that.
export async function loadFileIntoEngine(engine: AudioStage, file: File) {
  const arrayBuffer = await file.arrayBuffer();
  const audioBuffer = await engine.ctx.decodeAudioData(arrayBuffer);
  engine.buffer = audioBuffer;
  return audioBuffer;
}

// Creates a fresh AudioBufferSourceNode from the already-decoded buffer and
// starts it. AudioBufferSourceNode can only be started once ever, so a new
// node is required on every Play press — this is the correct, cheap way to
// do that (no re-decoding).
export function startBuffer(engine: AudioStage): AudioBufferSourceNode | null {
  if (!engine.buffer) return null;
  stopSource(engine);
  const node = engine.ctx.createBufferSource();
  node.buffer = engine.buffer;
  node.loop = false; // plays through once and stops — doesn't loop forever
  node.connect(engine.inputGain);
  node.start();
  engine.sourceNode = node;
  return node;
}

export function playTestTone(engine: AudioStage, freq = 110) {
  stopSource(engine);
  const osc = engine.ctx.createOscillator();
  osc.type = 'sawtooth';
  osc.frequency.value = freq; // lets you tell modules apart when stacking them
  osc.connect(engine.inputGain);
  engine.sourceNode = osc;
  osc.start();
}

export function stopSource(engine: AudioStage) {
  if (engine.sourceNode) {
    try {
      engine.sourceNode.stop();
    } catch {
      // already stopped, or never started — fine either way
    }
    engine.sourceNode.disconnect();
    engine.sourceNode = null;
  }
}

function readAnalyserLevel(analyser: AnalyserNode): number {
  const data = new Uint8Array(analyser.fftSize);
  analyser.getByteTimeDomainData(data);
  let sumSquares = 0;
  for (let i = 0; i < data.length; i++) {
    const v = (data[i] - 128) / 128;
    sumSquares += v * v;
  }
  return Math.sqrt(sumSquares / data.length);
}

// RMS-based level read, 0..1, for driving a channel meter.
export function readLevel(engine: { analyser: AnalyserNode }): number {
  return readAnalyserLevel(engine.analyser);
}

// ---------------------------------------------------------------------------
// Power Dynamics — compressor + limiter module.
//
// Real signal-chain order: input -> compressor (gentler, musical gain
// control) -> limiter (a second, harder stage that catches peaks the
// compressor lets through) -> output trim -> meter -> master bus. Both
// stages are genuine Web Audio DynamicsCompressorNodes (threshold, knee,
// ratio, attack, release) — this is the same tool real DAWs ship, not a
// cosmetic knob.
// ---------------------------------------------------------------------------

export type DynamicsEngine = AudioStage & {
  compressor: DynamicsCompressorNode;
  limiter: DynamicsCompressorNode;
  outputGain: GainNode;
  analyser: AnalyserNode;
};

export function createDynamicsEngine(bus: MasterBus): DynamicsEngine {
  const ctx = bus.ctx;

  const inputGain = ctx.createGain();
  inputGain.gain.value = 1;

  const compressor = ctx.createDynamicsCompressor();
  compressor.threshold.value = -24;
  compressor.knee.value = 18;
  compressor.ratio.value = 3;
  compressor.attack.value = 0.01;
  compressor.release.value = 0.2;

  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -3;
  limiter.knee.value = 0;
  limiter.ratio.value = 20; // Web Audio's max ratio — the hardest clamp this node can do
  limiter.attack.value = 0.001;
  limiter.release.value = 0.1;

  const outputGain = ctx.createGain();
  outputGain.gain.value = 0.9;

  const analyser = ctx.createAnalyser();
  analyser.fftSize = 1024;
  analyser.smoothingTimeConstant = 0.75;

  inputGain.connect(compressor);
  compressor.connect(limiter);
  limiter.connect(outputGain);
  outputGain.connect(analyser);
  analyser.connect(bus.masterGain);

  return {
    ctx,
    sourceNode: null,
    buffer: null,
    inputGain,
    micNode: null,
    micStream: null,
    compressor,
    limiter,
    outputGain,
    analyser,
  };
}

export function setCompThreshold(engine: DynamicsEngine, db: number) {
  engine.compressor.threshold.setTargetAtTime(db, engine.ctx.currentTime, 0.01);
}

export function setCompRatio(engine: DynamicsEngine, ratio: number) {
  engine.compressor.ratio.setTargetAtTime(ratio, engine.ctx.currentTime, 0.01);
}

export function setCompAttack(engine: DynamicsEngine, seconds: number) {
  engine.compressor.attack.setTargetAtTime(seconds, engine.ctx.currentTime, 0.01);
}

export function setCompRelease(engine: DynamicsEngine, seconds: number) {
  engine.compressor.release.setTargetAtTime(seconds, engine.ctx.currentTime, 0.01);
}

// The limiter's ceiling — how close to 0dB peaks are allowed before the
// hard, fast stage clamps them. Lower = louder incoming peaks get caught.
export function setLimiterCeiling(engine: DynamicsEngine, db: number) {
  engine.limiter.threshold.setTargetAtTime(db, engine.ctx.currentTime, 0.01);
}

export function setDynOutputLevel(engine: DynamicsEngine, amount01: number) {
  const db = amount01 <= 0 ? -60 : -60 * (1 - amount01);
  const gain = Math.pow(10, db / 20);
  engine.outputGain.gain.setTargetAtTime(gain, engine.ctx.currentTime, 0.01);
}

// How many dB of gain reduction the compressor is currently applying —
// drives a GR meter the same way readLevel() drives a signal meter.
export function readGainReduction(engine: DynamicsEngine): number {
  return engine.compressor.reduction;
}

// ---------------------------------------------------------------------------
// Power Tape — original tape-machine-style emulation. Three real, modeled
// tape phenomena, not just a label: (1) saturation — a softer, more
// symmetric knee than the preamp curve, since tape rounds peaks rather than
// adding grit; (2) wow & flutter — a slow (~0.6Hz) and a fast (~8Hz) LFO
// wobbling a short DelayNode's delay time, which IS physically what pitch
// drift from inconsistent tape speed looks like; (3) tape hiss — a
// filtered noise bed mixed in underneath. None of this names or models any
// specific manufacturer's machine.
// ---------------------------------------------------------------------------

export type TapeEngine = AudioStage & {
  satShaper: WaveShaperNode;
  wobbleDelay: DelayNode;
  wowGain: GainNode;
  flutterGain: GainNode;
  noiseGain: GainNode;
  outputGain: GainNode;
  analyser: AnalyserNode;
};

function makeTapeCurve(amount: number): Float32Array<ArrayBuffer> {
  const n = 2048;
  const curve = new Float32Array(n);
  const drive = 1 + Math.pow(amount, 1.6) * 5;
  const norm = Math.tanh(drive) || 1;
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    const wet = Math.tanh(drive * x) / norm;
    curve[i] = amount <= 0 ? x : wet * amount + x * (1 - amount);
  }
  return curve;
}

function createNoiseBuffer(ctx: AudioContext): AudioBuffer {
  const length = ctx.sampleRate * 2;
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
  return buffer;
}

export function createTapeEngine(bus: MasterBus): TapeEngine {
  const ctx = bus.ctx;

  const inputGain = ctx.createGain();
  inputGain.gain.value = 1;

  const satShaper = ctx.createWaveShaper();
  satShaper.curve = makeTapeCurve(0.2);
  satShaper.oversample = '4x';

  const wobbleDelay = ctx.createDelay(0.05);
  wobbleDelay.delayTime.value = 0.008;

  const wowOsc = ctx.createOscillator();
  wowOsc.type = 'sine';
  wowOsc.frequency.value = 0.6;
  const wowGain = ctx.createGain();
  wowGain.gain.value = 0.0005;
  wowOsc.connect(wowGain);
  wowGain.connect(wobbleDelay.delayTime);
  wowOsc.start();

  const flutterOsc = ctx.createOscillator();
  flutterOsc.type = 'sine';
  flutterOsc.frequency.value = 8;
  const flutterGain = ctx.createGain();
  flutterGain.gain.value = 0.00015;
  flutterOsc.connect(flutterGain);
  flutterGain.connect(wobbleDelay.delayTime);
  flutterOsc.start();

  const noiseSource = ctx.createBufferSource();
  noiseSource.buffer = createNoiseBuffer(ctx);
  noiseSource.loop = true;
  const noiseFilter = ctx.createBiquadFilter();
  noiseFilter.type = 'bandpass';
  noiseFilter.frequency.value = 6000;
  noiseFilter.Q.value = 0.5;
  const noiseGain = ctx.createGain();
  noiseGain.gain.value = 0;
  noiseSource.connect(noiseFilter);
  noiseFilter.connect(noiseGain);
  noiseSource.start();

  const outputGain = ctx.createGain();
  outputGain.gain.value = 0.85;

  const analyser = ctx.createAnalyser();
  analyser.fftSize = 1024;
  analyser.smoothingTimeConstant = 0.75;

  inputGain.connect(satShaper);
  satShaper.connect(wobbleDelay);
  wobbleDelay.connect(outputGain);
  noiseGain.connect(outputGain);
  outputGain.connect(analyser);
  analyser.connect(bus.masterGain);

  return {
    ctx,
    sourceNode: null,
    buffer: null,
    inputGain,
    micNode: null,
    micStream: null,
    satShaper,
    wobbleDelay,
    wowGain,
    flutterGain,
    noiseGain,
    outputGain,
    analyser,
  };
}

export function setTapeDrive(engine: TapeEngine, amount01: number) {
  engine.satShaper.curve = makeTapeCurve(amount01);
}

export function setWowFlutterDepth(engine: TapeEngine, amount01: number) {
  engine.wowGain.gain.setTargetAtTime(amount01 * 0.0022, engine.ctx.currentTime, 0.01);
  engine.flutterGain.gain.setTargetAtTime(amount01 * 0.0007, engine.ctx.currentTime, 0.01);
}

export function setTapeNoiseLevel(engine: TapeEngine, amount01: number) {
  engine.noiseGain.gain.setTargetAtTime(amount01 * 0.045, engine.ctx.currentTime, 0.01);
}

export function setTapeOutputLevel(engine: TapeEngine, amount01: number) {
  const db = amount01 <= 0 ? -60 : -60 * (1 - amount01);
  const gain = Math.pow(10, db / 20);
  engine.outputGain.gain.setTargetAtTime(gain, engine.ctx.currentTime, 0.01);
}

// ---------------------------------------------------------------------------
// Shared signal chain — the real wiring that makes Power Mix One and Power
// Tape one instrument instead of two unrelated engines that happen to sit
// on the same page.
//
//   source (file / mic) -> preamp (channel) -> tape -> master bus -> speakers
//
// Power Mix One's channel strip no longer feeds the master bus directly —
// its output is redirected into the tape engine's input, so everything
// that passes through the preamp is then captured by the tape stage. One
// AudioContext, one chain, created once and shared by both units.
// ---------------------------------------------------------------------------

export type SignalChain = {
  bus: MasterBus;
  channel: ChannelEngine; // the preamp
  tape: TapeEngine;
};

let sharedChain: SignalChain | null = null;

export function getSignalChain(): SignalChain {
  if (!sharedChain) {
    const bus = createMasterBus();
    const channel = createChannelEngine(bus);
    const tape = createTapeEngine(bus);

    // Redirect: preamp output -> tape input, instead of preamp -> master.
    // Tape is now the final coloring stage before the master bus.
    channel.analyser.disconnect(bus.masterGain);
    channel.analyser.connect(tape.inputGain);

    sharedChain = { bus, channel, tape };
  }
  return sharedChain;
}
