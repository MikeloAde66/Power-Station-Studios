import { put, list, del } from '@vercel/blob';

// Cloud-saved playlists for Power Tape. One JSON index blob holds every
// saved playlist's metadata + track URLs; the actual audio for each track
// lives as its own blob under playlists/{id}/. Simple on purpose: no
// database, no accounts — this is a single shared library behind the
// existing purchase-unlock gate, not a per-customer system.

const INDEX_PATH = 'playlists/index.json';

export type SavedTrack = { name: string; type: string; url: string; pathname: string };
export type SavedPlaylist = { id: string; name: string; updatedAt: number; tracks: SavedTrack[] };

async function readIndex(): Promise<SavedPlaylist[]> {
  try {
    const { blobs } = await list({ prefix: INDEX_PATH, limit: 1 });
    const entry = blobs.find((b) => b.pathname === INDEX_PATH);
    if (!entry) return [];
    const res = await fetch(entry.url, { cache: 'no-store' });
    if (!res.ok) return [];
    const data = (await res.json()) as SavedPlaylist[];
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

async function writeIndex(playlists: SavedPlaylist[]): Promise<void> {
  await put(INDEX_PATH, JSON.stringify(playlists), {
    access: 'public',
    contentType: 'application/json',
    allowOverwrite: true,
  });
}

export async function listPlaylists(): Promise<SavedPlaylist[]> {
  const playlists = await readIndex();
  return [...playlists].sort((a, b) => b.updatedAt - a.updatedAt);
}

type IncomingFile = { name: string; type: string; buffer: Buffer };

export async function savePlaylist(id: string, name: string, files: IncomingFile[]): Promise<SavedPlaylist> {
  const existing = await readIndex();
  const prior = existing.find((p) => p.id === id);
  // Replacing a saved playlist's tracks entirely each time keeps this
  // simple — no diffing — so clear out whatever was there before re-upload.
  if (prior) {
    await Promise.all(prior.tracks.map((t) => del(t.pathname).catch(() => {})));
  }
  const tracks: SavedTrack[] = [];
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    const pathname = `playlists/${id}/${i}-${f.name}`;
    const blob = await put(pathname, f.buffer, {
      access: 'public',
      contentType: f.type || 'audio/mpeg',
      allowOverwrite: true,
    });
    tracks.push({ name: f.name, type: f.type, url: blob.url, pathname: blob.pathname });
  }
  const record: SavedPlaylist = { id, name, updatedAt: Date.now(), tracks };
  await writeIndex([...existing.filter((p) => p.id !== id), record]);
  return record;
}

export async function deletePlaylist(id: string): Promise<void> {
  const existing = await readIndex();
  const prior = existing.find((p) => p.id === id);
  if (prior) {
    await Promise.all(prior.tracks.map((t) => del(t.pathname).catch(() => {})));
  }
  await writeIndex(existing.filter((p) => p.id !== id));
}
