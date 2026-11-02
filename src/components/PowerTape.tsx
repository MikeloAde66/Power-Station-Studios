'use client';

import Image from 'next/image';
import { useEffect, useRef, useState } from 'react';
import {
  connectMic,
  disconnectMic,
  getSignalChain,
  loadFileIntoEngine,
  playTestTone,
  readLevel,
  setTapeDrive,
  setTapeNoiseLevel,
  setTapeOutputLevel,
  setWowFlutterDepth,
  startBuffer,
  stopSource,
  type ChannelEngine,
  type TapeEngine,
} from '@/lib/audioEngine';
import Knob from './Knob';
import VUMeter from './VUMeter';
import styles from './PowerTape.module.css';

// Real tape-character presets (drive/wobble/noise/output) — named for what
// they sound like, not borrowed from any real machine or manufacturer.
type Preset = { name: string; drive: number; wobble: number; noise: number; output: number };

// Output stays at unity across every preset (see the note on
// setTapeOutputLevel) — nothing trims level by default.
//
// Noise floor defaults to 0 everywhere, full stop. Character comes from
// drive/wobble, which an engineer dials up on purpose; nothing here should
// hand them hiss they didn't ask for. WARM TAPE is the default preset on
// load — it's the signature character people expect from this unit — and
// every other preset was pulled back to a genuinely subtle amount — a
// plugin's job is subtle shaping, not an effect so loud it reads as broken
// on first listen. DESTROYED was renamed SOFT LIMITER and rebuilt as plain
// saturation/limiting — no wobble, no noise, nothing that made the
// original version unusable.
const PRESETS: Preset[] = [
  { name: 'CLEAN TAPE', drive: 5, wobble: 0, noise: 0, output: 100 },
  { name: 'WARM TAPE', drive: 25, wobble: 6, noise: 4, output: 100 },
  { name: 'VINTAGE WOBBLE', drive: 30, wobble: 12, noise: 6, output: 100 },
  { name: 'LO-FI CASSETTE', drive: 40, wobble: 15, noise: 10, output: 100 },
  { name: 'SOFT LIMITER', drive: 45, wobble: 0, noise: 0, output: 100 },
];

// Cloud-saved playlist shapes, mirroring the server's src/lib/playlistStorage.ts.
type SavedTrack = { name: string; type: string; url: string; pathname: string };
type SavedPlaylistRecord = { id: string; name: string; updatedAt: number; tracks: SavedTrack[] };

function SaveIcon() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ display: 'block' }}
      aria-hidden="true"
    >
      <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2Z" />
      <path d="M17 21v-8H7v8" />
      <path d="M7 3v5h8" />
    </svg>
  );
}

function formatCounter(seconds: number) {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

type PowerTapeProps = {
  // Called when the PRE-AMP button is clicked, so the page can open Power
  // Mix One as an overlay. Tape stays the thing people see by default; the
  // preamp is a deliberate, on-demand visit, not a second module competing
  // for attention on the same page.
  onOpenPreamp?: () => void;
  // Whether the preamp is currently engaged (live), reported back up from
  // Power Mix One so this unit's own PRE-AMP button can carry the same
  // green/red state language as the rest of the panel.
  preampLive?: boolean;
};

export default function PowerTape({ onOpenPreamp, preampLive = false }: PowerTapeProps) {
  // Tape is the only transport now: the preamp (channel) is the true source
  // stage — file/mic input lands there first — and tape is the coloring
  // stage that always receives whatever the preamp is putting out. Both
  // refs point at the one shared signal chain.
  const channelRef = useRef<ChannelEngine | null>(null);
  const engineRef = useRef<TapeEngine | null>(null);
  const rafRef = useRef<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const playlistInputRef = useRef<HTMLInputElement>(null);
  const startCtxTimeRef = useRef<number | null>(null);
  // Responsive scaling: the whole deck is a pixel-exact 1180px design (the
  // reel/tape-path geometry depends on exact px relationships), so instead
  // of reflowing it for every screen we scale the whole thing uniformly to
  // fit the available width — desktop, iPad, or phone — and reserve exactly
  // that scaled height so nothing leaves blank space or clips.
  const stageRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const [stageHeight, setStageHeight] = useState<number | null>(null);
  const DESIGN_WIDTH = 1180;
  // Mirrors `playlist` state so the onended auto-advance callback (set up
  // once per track) always reads the current list instead of a stale one
  // captured when that callback was created.
  const playlistRef = useRef<{ name: string; file: File }[]>([]);

  const [playing, setPlaying] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);
  const [drive, setDriveState] = useState(25);
  const [wobble, setWobble] = useState(6);
  const [noise, setNoise] = useState(4);
  const [output, setOutput] = useState(100);
  const [meter, setMeter] = useState(0);
  const [elapsedSec, setElapsedSec] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [activePreset, setActivePreset] = useState<string | null>('WARM TAPE');
  const [micActive, setMicActive] = useState(false);
  const [flipped, setFlipped] = useState(false);
  const [playlist, setPlaylist] = useState<{ name: string; file: File }[]>([]);
  const [currentTrackIndex, setCurrentTrackIndex] = useState<number | null>(null);
  // Demo gating: the public live site is demo-only (one bundled track, no
  // upload, no playlist loader) until a purchase unlocks this browser via
  // the signed cookie set on /download. Defaults to locked so there's no
  // flash of full controls before the check resolves.
  const [unlocked, setUnlocked] = useState(false);

  // Cloud-saved playlists (see src/lib/playlistStorage.ts): one shared
  // library behind the same purchase-unlock gate as the rest of the app,
  // no separate login. currentPlaylistId/Name track which saved playlist
  // (if any) is currently loaded, so a plain "Save" knows what to overwrite.
  const [savedPlaylists, setSavedPlaylists] = useState<SavedPlaylistRecord[]>([]);
  const [saveMenuOpen, setSaveMenuOpen] = useState(false);
  const [currentPlaylistId, setCurrentPlaylistId] = useState<string | null>(null);
  const [currentPlaylistName, setCurrentPlaylistName] = useState<string | null>(null);
  const [savingAsOpen, setSavingAsOpen] = useState(false);
  const [savingAsDraft, setSavingAsDraft] = useState('');
  const [cloudBusy, setCloudBusy] = useState(false);
  const saveMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch('/api/unlock-status')
      .then((res) => res.json())
      .then((data) => setUnlocked(Boolean(data?.unlocked)))
      .catch(() => setUnlocked(false));
  }, []);

  async function refreshSavedPlaylists() {
    try {
      const res = await fetch('/api/playlists');
      if (!res.ok) return;
      const data = await res.json();
      setSavedPlaylists(Array.isArray(data?.playlists) ? data.playlists : []);
    } catch {
      // Saved-playlist list is a convenience, not critical path — fail quiet.
    }
  }

  useEffect(() => {
    // Fetching the saved-playlist list on unlock is exactly what an effect
    // is for (syncing with an external system on a prop/state change) —
    // the lint rule's static analysis just can't see past the async
    // function call to know the setState inside it happens post-await.
    if (unlocked) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      refreshSavedPlaylists();
    }
  }, [unlocked]);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (saveMenuRef.current && !saveMenuRef.current.contains(e.target as Node)) {
        setSaveMenuOpen(false);
        setSavingAsOpen(false);
      }
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  // First thing an unlocked engineer should see is a choice, not a wall of
  // knobs: load a single file or a whole playlist. Derived rather than its
  // own effect-driven state, so it closes itself the instant something's
  // actually loaded with no extra render pass, and can still be skipped
  // outright for someone who just wants to look around first. Locked
  // (demo) visitors never see this — they have nothing to upload, just the
  // TRY DEMO button.
  const [onboardingDismissed, setOnboardingDismissed] = useState(false);
  const showOnboarding = !onboardingDismissed && !fileName && playlist.length === 0;

  function ensureEngine() {
    if (!engineRef.current) {
      const chain = getSignalChain();
      channelRef.current = chain.channel;
      const engine = chain.tape;
      setTapeDrive(engine, drive / 100);
      setWowFlutterDepth(engine, wobble / 100);
      setTapeNoiseLevel(engine, noise / 100);
      setTapeOutputLevel(engine, output / 100);
      engineRef.current = engine;
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
    // Started here (not inside ensureEngine) so the meter/counter loop is
    // re-armed on every effect run, including React StrictMode's
    // dev-mode mount -> cleanup -> mount cycle, which would otherwise
    // cancel the one scheduled frame from ensureEngine's one-time setup
    // and leave the loop permanently stopped.
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      if (channelRef.current) disconnectMic(channelRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Scale the whole 1180px-design deck to fit whatever width it's given —
  // desktop, iPad, or phone — and track its natural (unscaled) height so
  // the stage reserves exactly the scaled-down space, no blank gap, no
  // clipping. ResizeObserver reports layout size, which ignores the CSS
  // transform we apply for the scale itself, so this stays accurate even
  // as the playlist panel grows/shrinks the deck's natural height.
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;

    const stageObserver = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width ?? stage.clientWidth;
      setScale(Math.min(1, width / DESIGN_WIDTH));
    });
    stageObserver.observe(stage);
    return () => stageObserver.disconnect();
  }, []);

  // getBoundingClientRect already reflects the transform's visual size, so
  // no scale math here — just measure it fresh after scale or content
  // (e.g. the playlist panel appearing) changes the rendered height, and
  // reserve exactly that in the stage so nothing clips or leaves a gap.
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    const raf = requestAnimationFrame(() => {
      setStageHeight(scene.getBoundingClientRect().height);
    });
    return () => cancelAnimationFrame(raf);
  }, [scale, playlist.length, flipped]);

  async function loadFile(file: File) {
    setError(null);
    try {
      ensureEngine();
      const channel = channelRef.current!;
      await channel.ctx.resume();
      await loadFileIntoEngine(channel, file);
      setFileName(file.name);
      // The preamp is always engaged in the background the moment a file
      // loads — it's the source stage every signal already passes
      // through — but it no longer pops its own modal open on every
      // load. Opening it is a deliberate visit via the PRE-AMP button,
      // not an interruption between picking a file and hearing it play.
    } catch (err) {
      setError(`Couldn't decode that file: ${(err as Error).message ?? err}`);
    }
  }

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    await loadFile(file);
  }

  // Demo mode: the public live site runs the one bundled demo track and
  // nothing a visitor brings themselves — uploading and the playlist loader
  // are purchase-only. This fetches that one track and runs it through the
  // exact same load path as a real upload.
  async function handleLoadDemo() {
    setError(null);
    try {
      const res = await fetch('/demo/demo-track.mp3');
      if (!res.ok) throw new Error('Demo track unavailable right now.');
      const blob = await res.blob();
      await loadFile(new File([blob], 'Power Tape Demo.mp3', { type: 'audio/mpeg' }));
    } catch (err) {
      setError((err as Error).message ?? "Couldn't load the demo track.");
    }
  }

  async function handlePlay() {
    // With a playlist loaded, Play resumes/advances through it — the same
    // path selectTrack already uses for auto-advance — instead of the
    // single-file logic below.
    if (playlist.length > 0 && currentTrackIndex !== null) {
      await selectTrack(currentTrackIndex, { autoPlay: true });
      return;
    }
    setError(null);
    try {
      ensureEngine();
      const channel = channelRef.current!;
      if (micActive) {
        disconnectMic(channel);
        setMicActive(false);
      }
      await channel.ctx.resume();
      if (fileName && channel.buffer) {
        const node = startBuffer(channel);
        if (node) {
          node.onended = () => {
            setPlaying(false);
            startCtxTimeRef.current = null;
            setElapsedSec(0);
          };
        }
      } else {
        playTestTone(channel, 165);
      }
      startCtxTimeRef.current = channel.ctx.currentTime;
      setElapsedSec(0);
      setPlaying(true);
    } catch (err) {
      setError(`Playback failed: ${(err as Error).message ?? err}`);
    }
  }

  // --- Playlist: a batch loader next to the preset select. Each add can
  // carry up to 15 songs; they append to whatever's already queued. Click
  // a track to jump to it (keeps playing if something already was); let
  // one run to the end and the next track picks up automatically. ---

  function appendToPlaylist(files: File[]) {
    const newItems = files.map((file) => ({ name: file.name, file }));
    const next = [...playlistRef.current, ...newItems];
    playlistRef.current = next;
    setPlaylist(next);
    return next;
  }

  async function selectTrack(index: number, opts: { openPreamp?: boolean; autoPlay?: boolean } = {}) {
    const list = playlistRef.current;
    if (index < 0 || index >= list.length) return;
    setError(null);
    try {
      ensureEngine();
      const channel = channelRef.current!;
      if (micActive) {
        disconnectMic(channel);
        setMicActive(false);
      }
      stopSource(channel);
      await channel.ctx.resume();
      await loadFileIntoEngine(channel, list[index].file);
      setFileName(list[index].name);
      setCurrentTrackIndex(index);
      if (opts.openPreamp) onOpenPreamp?.();
      if (opts.autoPlay) {
        const node = startBuffer(channel);
        if (node) {
          node.onended = () => {
            const nextIndex = index + 1;
            if (nextIndex < playlistRef.current.length) {
              selectTrack(nextIndex, { autoPlay: true });
            } else {
              setPlaying(false);
              startCtxTimeRef.current = null;
              setElapsedSec(0);
            }
          };
        }
        startCtxTimeRef.current = channel.ctx.currentTime;
        setElapsedSec(0);
        setPlaying(true);
      }
    } catch (err) {
      setError(`Couldn't load that track: ${(err as Error).message ?? err}`);
    }
  }

  async function handlePlaylistFiles(e: React.ChangeEvent<HTMLInputElement>) {
    let files = Array.from(e.target.files ?? []);
    if (files.length === 0) return;
    e.target.value = ''; // lets the same files be picked again later
    // Set after selectTrack runs (below), since selectTrack clears the
    // error banner at its own start — setting this first would just get
    // wiped out immediately by that first-track auto-load.
    let overflowMessage: string | null = null;
    if (files.length > 15) {
      overflowMessage = `Only the first 15 of ${files.length} selected songs were added — add the rest in another batch.`;
      files = files.slice(0, 15);
    }
    const wasEmpty = playlistRef.current.length === 0;
    const startIndex = playlistRef.current.length;
    appendToPlaylist(files);
    if (wasEmpty) {
      await selectTrack(startIndex);
    }
    if (overflowMessage) setError(overflowMessage);
  }

  function removeTrack(index: number) {
    const next = playlistRef.current.filter((_, i) => i !== index);
    playlistRef.current = next;
    setPlaylist(next);
    if (currentTrackIndex === index) {
      setCurrentTrackIndex(null);
      if (playing) handleStop();
    } else if (currentTrackIndex !== null && index < currentTrackIndex) {
      setCurrentTrackIndex(currentTrackIndex - 1);
    }
  }

  function clearPlaylist() {
    playlistRef.current = [];
    setPlaylist([]);
    setCurrentTrackIndex(null);
    setCurrentPlaylistId(null);
    setCurrentPlaylistName(null);
    if (playing) handleStop();
  }

  // --- Cloud playlist save/load: the actual audio for the currently
  // loaded playlist gets uploaded to Blob storage under a name, and comes
  // back later as a one-click load — no re-picking files from Finder. ---

  async function persistPlaylist(id: string, name: string) {
    if (playlist.length === 0) {
      setError('Load some tracks before saving a playlist.');
      return;
    }
    setCloudBusy(true);
    setError(null);
    try {
      const form = new FormData();
      form.set('id', id);
      form.set('name', name);
      playlist.forEach((track) => form.append('files', track.file, track.name));
      const res = await fetch('/api/playlists', { method: 'POST', body: form });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? 'Save failed');
      }
      const data = await res.json();
      setCurrentPlaylistId(data.playlist.id);
      setCurrentPlaylistName(data.playlist.name);
      await refreshSavedPlaylists();
    } catch (err) {
      setError(`Couldn't save the playlist: ${(err as Error).message ?? err}`);
    } finally {
      setCloudBusy(false);
    }
  }

  async function handleSaveClick() {
    if (currentPlaylistId && currentPlaylistName) {
      await persistPlaylist(currentPlaylistId, currentPlaylistName);
      setSaveMenuOpen(false);
    } else {
      setSavingAsDraft('');
      setSavingAsOpen(true);
    }
  }

  function handleSaveAsClick() {
    setSavingAsDraft(currentPlaylistName ?? '');
    setSavingAsOpen(true);
  }

  async function confirmSaveAs() {
    const name = savingAsDraft.trim();
    if (!name) return;
    const id = crypto.randomUUID();
    await persistPlaylist(id, name);
    setSavingAsOpen(false);
    setSaveMenuOpen(false);
  }

  async function handleLoadSavedPlaylist(record: SavedPlaylistRecord) {
    setCloudBusy(true);
    setError(null);
    try {
      const files = await Promise.all(
        record.tracks.map(async (t) => {
          const res = await fetch(t.url);
          if (!res.ok) throw new Error(`Couldn't fetch "${t.name}"`);
          const blob = await res.blob();
          return new File([blob], t.name, { type: t.type || blob.type });
        })
      );
      clearPlaylist();
      ensureEngine();
      appendToPlaylist(files);
      setCurrentPlaylistId(record.id);
      setCurrentPlaylistName(record.name);
      await selectTrack(0);
      setSaveMenuOpen(false);
    } catch (err) {
      setError(`Couldn't load that playlist: ${(err as Error).message ?? err}`);
    } finally {
      setCloudBusy(false);
    }
  }

  async function handleDeleteSavedPlaylist(id: string, e: React.MouseEvent) {
    e.stopPropagation();
    setCloudBusy(true);
    try {
      await fetch(`/api/playlists/${id}`, { method: 'DELETE' });
      if (currentPlaylistId === id) {
        setCurrentPlaylistId(null);
        setCurrentPlaylistName(null);
      }
      await refreshSavedPlaylists();
    } catch {
      setError("Couldn't delete that saved playlist.");
    } finally {
      setCloudBusy(false);
    }
  }

  // << / >> step one track at a time through the playlist — keeps playing
  // if something already was, otherwise just loads the new track.
  function handlePrevTrack() {
    if (currentTrackIndex === null || currentTrackIndex <= 0) return;
    selectTrack(currentTrackIndex - 1, { autoPlay: playing });
  }

  function handleNextTrack() {
    if (currentTrackIndex === null || currentTrackIndex >= playlist.length - 1) return;
    selectTrack(currentTrackIndex + 1, { autoPlay: playing });
  }

  function handleStop() {
    const channel = channelRef.current;
    if (channel) stopSource(channel);
    setPlaying(false);
    startCtxTimeRef.current = null;
    setElapsedSec(0);
  }

  async function handleMicToggle() {
    setError(null);
    try {
      ensureEngine();
      const channel = channelRef.current!;
      if (micActive) {
        disconnectMic(channel);
        setMicActive(false);
        startCtxTimeRef.current = null;
        setElapsedSec(0);
        return;
      }
      stopSource(channel);
      setPlaying(false);
      await channel.ctx.resume();
      await connectMic(channel);
      startCtxTimeRef.current = channel.ctx.currentTime;
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

  const heroEngaged = activePreset === 'WARM TAPE';
  function handleHeroEngage() {
    applyPreset(PRESETS[1]);
  }

  const liveState = micActive ? 'Capturing live input (LIVE)' : playing ? 'Playing' : 'Standby';

  // The hero bar doubles as a metadata feed: once something is actually
  // sounding, it shows what — the loaded file's name, or LIVE INPUT for
  // the mic — lit for as long as it's playing. Nothing loaded/playing
  // means no label at all, just the bare dot.
  const feedText = micActive ? 'LIVE INPUT' : fileName ? fileName.replace(/\.[^/.]+$/, '').toUpperCase() : null;
  const feedLive = playing || micActive;
  const feedColorClass = feedLive ? (micActive ? styles.feedGreen : styles.feedBlue) : '';

  return (
    <div
      ref={stageRef}
      className={styles.responsiveStage}
      style={stageHeight != null ? { height: stageHeight } : undefined}
    >
    {unlocked && showOnboarding && (
      <div className={styles.onboardBackdrop}>
        <div className={styles.onboardCard}>
          <h2 className={styles.onboardTitle}>LOAD YOUR MUSIC</h2>
          <p className={styles.onboardSubtitle}>
            Bring in one track to hear it through Power Tape, or load a whole
            playlist at once and batch through it.
          </p>
          <div className={styles.onboardActions}>
            <button
              type="button"
              className={styles.onboardBtn}
              onClick={() => fileInputRef.current?.click()}
            >
              UPLOAD A FILE
            </button>
            <button
              type="button"
              className={`${styles.onboardBtn} ${styles.onboardBtnSecondary}`}
              onClick={() => playlistInputRef.current?.click()}
            >
              LOAD A PLAYLIST
            </button>
          </div>
          <button type="button" className={styles.onboardSkip} onClick={() => setOnboardingDismissed(true)}>
            Skip for now
          </button>
        </div>
      </div>
    )}
    <div
      ref={sceneRef}
      className={styles.flipScene}
      style={{ transform: `scale(${scale})`, transformOrigin: 'top center' }}
    >
      <div className={`${styles.flipCard} ${flipped ? styles.flipped : ''}`}>
        <div className={`${styles.cardFace} ${styles.cardFront}`}>
          <div className={styles.frame}>
            <div className={styles.screw} data-pos="tl" />
            <div className={styles.screw} data-pos="tr" />
            <div className={styles.screw} data-pos="bl" />
            <div className={styles.screw} data-pos="br" />

            <div className={styles.header}>
              <div className={styles.brandBlock}>
                <div className={styles.wordmark}>POWER TAPE</div>
                <div className={styles.tagline}>REAL-TIME ANALOG CAPTURE</div>
              </div>
              <div className={styles.headerRight}>
                <div className={styles.lampCluster} title={liveState}>
                  <span className={`${styles.lamp} ${styles.lampStandby} ${!playing && !micActive ? styles.lampLit : ''}`} />
                  <span className={`${styles.lamp} ${styles.lampPlay} ${playing ? styles.lampLit : ''}`} title="Green = live" />
                  <span className={`${styles.lamp} ${styles.lampCapture} ${micActive ? styles.lampLit : ''}`} />
                </div>
                <button
                  type="button"
                  className={styles.flipBtn}
                  onClick={() => setFlipped(true)}
                  title="View connections"
                >
                  &#8635;
                </button>
                <button
                  type="button"
                  className={styles.preampBtn}
                  onClick={onOpenPreamp}
                  title={preampLive ? 'Open the preamp (live)' : 'Open the preamp'}
                >
                  <span className={`${styles.preampDot} ${preampLive ? styles.preampDotOn : styles.preampDotOff}`} />
                  PRE-AMP
                </button>
                {unlocked ? (
                  <>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="audio/*"
                      onChange={handleFile}
                      className={styles.fileInput}
                      id="pt-upload"
                    />
                    <div className={styles.saveMenuWrap} ref={saveMenuRef}>
                      <button
                        type="button"
                        className={`${styles.uploadBtn} ${styles.saveIconBtn}`}
                        onClick={() => setSaveMenuOpen((v) => !v)}
                        title="Save this playlist to the cloud, or load one you saved before"
                        aria-label="Save or load playlists"
                      >
                        <SaveIcon />
                      </button>
                      {saveMenuOpen && (
                        <div className={styles.saveMenu}>
                          <button
                            type="button"
                            className={styles.saveMenuItem}
                            onClick={handleSaveClick}
                            disabled={playlist.length === 0 || cloudBusy}
                          >
                            {currentPlaylistName ? `Save "${currentPlaylistName}"` : 'Save'}
                          </button>
                          {savingAsOpen ? (
                            <div className={styles.saveAsRow}>
                              <input
                                autoFocus
                                className={styles.saveAsInput}
                                placeholder="Playlist name"
                                value={savingAsDraft}
                                onChange={(e) => setSavingAsDraft(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') confirmSaveAs();
                                  if (e.key === 'Escape') setSavingAsOpen(false);
                                }}
                              />
                              <button
                                type="button"
                                className={styles.saveAsConfirm}
                                onClick={confirmSaveAs}
                                disabled={!savingAsDraft.trim() || cloudBusy}
                                title="Confirm"
                              >
                                &#10003;
                              </button>
                            </div>
                          ) : (
                            <button
                              type="button"
                              className={styles.saveMenuItem}
                              onClick={handleSaveAsClick}
                              disabled={playlist.length === 0 || cloudBusy}
                            >
                              Save As&hellip;
                            </button>
                          )}
                          <div className={styles.saveMenuDivider} />
                          {savedPlaylists.length === 0 ? (
                            <div className={styles.saveMenuEmpty}>No saved playlists yet</div>
                          ) : (
                            <div className={styles.saveMenuList}>
                              {savedPlaylists.map((p) => (
                                <div
                                  key={p.id}
                                  className={`${styles.saveMenuRow} ${p.id === currentPlaylistId ? styles.saveMenuRowActive : ''}`}
                                  onClick={() => handleLoadSavedPlaylist(p)}
                                >
                                  <span className={styles.saveMenuRowName}>{p.name}</span>
                                  <span className={styles.saveMenuRowCount}>{p.tracks.length}</span>
                                  <button
                                    type="button"
                                    className={styles.saveMenuRowDelete}
                                    onClick={(e) => handleDeleteSavedPlaylist(p.id, e)}
                                    title="Delete this saved playlist"
                                  >
                                    &times;
                                  </button>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </>
                ) : (
                  <button
                    type="button"
                    className={styles.uploadBtn}
                    onClick={handleLoadDemo}
                    title="Play the free demo track — unlock full upload with purchase"
                  >
                    &rsaquo;&rsaquo;&rsaquo; TRY DEMO
                  </button>
                )}
              </div>
            </div>

      <button
        type="button"
        className={`${styles.heroEngage} ${heroEngaged ? styles.heroEngaged : ''} ${feedColorClass}`}
        onClick={handleHeroEngage}
        title={feedText ?? 'Engage the signature Power Tape character'}
      >
        <span className={styles.heroDot} />
        {feedText && <span className={styles.heroLabel}>{feedText}</span>}
      </button>

      <div className={styles.transportDeck}>
        <div className={`${styles.reel} ${spinning ? styles.spinning : ''}`}>
          <Image src="/tape/reel-full.png" alt="" fill sizes="220px" className={styles.reelImg} priority />
          <div className={styles.reelHub} />
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
          <div className={styles.reelHub} />
        </div>
      </div>

      <div className={styles.controlPanel}>
        <div className={styles.controlRow}>
          <VUMeter level01={meter} faceColor="#f5e9c4" needleColor="#2a1c0a" scaleColor="#3a2810" width={190} />
          <Knob label="DRIVE" value={drive} onChange={handleDriveChange} valueLabel={`${drive.toFixed(0)}%`} color="brass" size={92} />
          <Knob label="WOW/FLUTTER" value={wobble} onChange={handleWobbleChange} valueLabel={`${wobble.toFixed(0)}%`} color="brass" size={92} />
          <Knob label="NOISE" value={noise} onChange={handleNoiseChange} valueLabel={`${noise.toFixed(0)}%`} color="brass" size={92} />
          <Knob
            label="OUTPUT"
            value={output}
            onChange={handleOutputChange}
            valueLabel={outputDb <= -60 ? '-∞' : `${outputDb.toFixed(1)} dB`}
            color="brass"
            size={92}
          />
        </div>

        <div className={styles.controlRow}>
          <select
            className={styles.presetSelect}
            value={activePreset ?? ''}
            onChange={handlePresetSelect}
            title="More tape character options"
          >
            {!activePreset && <option value="">CUSTOM</option>}
            {PRESETS.map((p) => (
              <option key={p.name} value={p.name}>
                {p.name}
              </option>
            ))}
          </select>

          {unlocked && (
            <>
              <input
                ref={playlistInputRef}
                type="file"
                accept="audio/*"
                multiple
                onChange={handlePlaylistFiles}
                className={styles.fileInput}
                id="pt-playlist"
              />
              <label htmlFor="pt-playlist" className={styles.playlistBtn} title="Add up to 15 songs at once">
                + PLAYLIST
              </label>
            </>
          )}
          {!unlocked && (
            <button type="button" className={styles.playlistBtn} disabled title="Unlock with purchase to batch-load a playlist">
              + PLAYLIST (LOCKED)
            </button>
          )}

          <div className={styles.transportGroup}>
            <button
              className={styles.transportBtn}
              onClick={handlePrevTrack}
              disabled={currentTrackIndex === null || currentTrackIndex <= 0}
              title="Previous track"
            >
              &#9664;&#9664;
            </button>
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
            <button
              className={styles.transportBtn}
              onClick={handleNextTrack}
              disabled={currentTrackIndex === null || currentTrackIndex >= playlist.length - 1}
              title="Next track"
            >
              &#9654;&#9654;
            </button>
          </div>

          <div className={styles.counter}>
            <span className={styles.counterLabel}>COUNTER</span>
            <span className={styles.counterDigits}>{formatCounter(elapsedSec)}</span>
          </div>
        </div>
      </div>

            {playlist.length > 0 && (
              <div className={styles.playlistPanel}>
                <div className={styles.playlistHeader}>
                  <span>
                    PLAYLIST &mdash; {playlist.length} TRACK{playlist.length === 1 ? '' : 'S'}
                  </span>
                  <button type="button" className={styles.playlistClear} onClick={clearPlaylist}>
                    CLEAR
                  </button>
                </div>
                <div className={styles.playlistList}>
                  {playlist.map((track, i) => (
                    <div
                      key={`${track.name}-${i}`}
                      className={`${styles.playlistRow} ${i === currentTrackIndex ? styles.playlistRowActive : ''}`}
                      onClick={() => selectTrack(i, { autoPlay: playing })}
                    >
                      <span className={styles.playlistIndex}>{(i + 1).toString().padStart(2, '0')}</span>
                      <span className={styles.playlistName}>{track.name}</span>
                      <button
                        type="button"
                        className={styles.playlistRemove}
                        onClick={(e) => {
                          e.stopPropagation();
                          removeTrack(i);
                        }}
                        title="Remove from playlist"
                      >
                        &times;
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {error && <div className={styles.error}>{error}</div>}
          </div>
        </div>

        <div className={`${styles.cardFace} ${styles.cardBack}`}>
          <div className={styles.backFrame}>
            <div className={styles.screw} data-pos="tl" />
            <div className={styles.screw} data-pos="tr" />
            <div className={styles.screw} data-pos="bl" />
            <div className={styles.screw} data-pos="br" />

            <div className={styles.backHeader}>
              <div>
                <div className={styles.backWordmark}>POWER TAPE</div>
                <div className={styles.backModel}>MODEL PT-1 &middot; STANDALONE UNIT</div>
              </div>
              <button type="button" className={styles.flipBtn} onClick={() => setFlipped(false)} title="Back to front">
                &#8635;
              </button>
            </div>

            <div className={styles.jackBank}>
              <div className={styles.jackUnit}>
                <div className={styles.xlrJack}>
                  <span className={styles.xlrPin} />
                  <span className={styles.xlrPin} />
                  <span className={styles.xlrPin} />
                </div>
                <span className={styles.backJackLabel}>MIC IN</span>
              </div>
              <div className={styles.jackUnit}>
                <div className={styles.trsJack} />
                <span className={styles.backJackLabel}>LINE OUT</span>
              </div>
              <div className={styles.jackUnit}>
                <div className={styles.powerInlet}>
                  <span className={styles.powerPin} />
                  <span className={styles.powerPin} />
                  <span className={styles.powerPin} />
                </div>
                <span className={styles.backJackLabel}>POWER</span>
              </div>
            </div>

            <div className={styles.backSwitchRow}>
              <div className={styles.rockerSwitch}>
                <div className={styles.rockerKnob} />
              </div>
              <span className={styles.backJackLabel}>GND LIFT</span>
            </div>

            <div className={styles.backSpec}>
              FRONT PANEL LAMP &mdash; GREEN = LIVE SIGNAL
              <br />
              HANDBUILT CHARACTER &middot; NO CHAINING REQUIRED
            </div>

            <div className={styles.backSerial}>SER. PT-000001</div>
          </div>
        </div>
      </div>
    </div>
    </div>
  );
}
