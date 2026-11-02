import { randomUUID } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { UNLOCK_COOKIE_NAME, verifyUnlockToken } from '@/lib/access';
import { listPlaylists, savePlaylist } from '@/lib/playlistStorage';

// Saved playlists ride on the same purchase-unlock gate as everything else
// in the app (see /api/unlock-status) — no separate login, just "did this
// browser buy it." Local dev always passes, same as the rest of the app.
function isUnlocked(req: NextRequest): boolean {
  if (process.env.NODE_ENV !== 'production') return true;
  const token = req.cookies.get(UNLOCK_COOKIE_NAME)?.value;
  return verifyUnlockToken(token);
}

export const maxDuration = 60;

export async function GET(req: NextRequest) {
  if (!isUnlocked(req)) {
    return NextResponse.json({ error: 'Locked' }, { status: 403 });
  }
  const playlists = await listPlaylists();
  return NextResponse.json({ playlists });
}

export async function POST(req: NextRequest) {
  if (!isUnlocked(req)) {
    return NextResponse.json({ error: 'Locked' }, { status: 403 });
  }
  const form = await req.formData();
  const name = String(form.get('name') ?? '').trim();
  const id = String(form.get('id') ?? '').trim() || randomUUID();
  if (!name) {
    return NextResponse.json({ error: 'Name required' }, { status: 400 });
  }
  const fileEntries = form.getAll('files').filter((f): f is File => f instanceof File);
  if (fileEntries.length === 0) {
    return NextResponse.json({ error: 'No tracks to save' }, { status: 400 });
  }
  const files = await Promise.all(
    fileEntries.map(async (f) => ({
      name: f.name,
      type: f.type,
      buffer: Buffer.from(await f.arrayBuffer()),
    }))
  );
  const record = await savePlaylist(id, name, files);
  return NextResponse.json({ playlist: record });
}
