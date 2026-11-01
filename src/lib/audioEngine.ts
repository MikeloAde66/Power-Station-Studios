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

export type ChannelEngine = {
  ctx: AudioContext;
  sourceNode: AudioBufferSourceNode | null;
  buffer: AudioBuffer | null;
  inputGain: GainNode;
  shaper: WaveShaperNode;
  channelGain: GainNode;
  analyser: AnalyserNode;
  micNode: MediaStreamAudioSourceNode | null;
  micStream: MediaStream | null;
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
export async function connectMic(engine: ChannelEngine): Promise<void> {
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

export function disconnectMic(engine: ChannelEngine) {
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
export async function loadFileIntoEngine(engine: ChannelEngine, file: File) {
  const arrayBuffer = await file.arrayBuffer();
  const audioBuffer = await engine.ctx.decodeAudioData(arrayBuffer);
  engine.buffer = audioBuffer;
  return audioBuffer;
}

// Creates a fresh AudioBufferSourceNode from the already-decoded buffer and
// starts it. AudioBufferSourceNode can only be started once ever, so a new
// node is required on every Play press — this is the correct, cheap way to
// do that (no re-decoding).
export function startBuffer(engine: ChannelEngine): AudioBufferSourceNode | null {
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

export function playTestTone(engine: ChannelEngine, freq = 110) {
  stopSource(engine);
  const osc = engine.ctx.createOscillator();
  osc.type = 'sawtooth';
  osc.frequency.value = freq; // CH1/CH2 use different pitches so you can tell them apart
  osc.connect(engine.inputGain);
  engine.sourceNode = osc as unknown as AudioBufferSourceNode;
  osc.start();
}

export function stopSource(engine: ChannelEngine) {
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
export function readLevel(engine: ChannelEngine): number {
  return readAnalyserLevel(engine.analyser);
}
