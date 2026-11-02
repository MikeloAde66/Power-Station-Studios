import { NextRequest, NextResponse } from 'next/server';
import { UNLOCK_COOKIE_NAME, verifyUnlockToken } from '@/lib/access';
import { deletePlaylist } from '@/lib/playlistStorage';

function isUnlocked(req: NextRequest): boolean {
  if (process.env.NODE_ENV !== 'production') return true;
  const token = req.cookies.get(UNLOCK_COOKIE_NAME)?.value;
  return verifyUnlockToken(token);
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!isUnlocked(req)) {
    return NextResponse.json({ error: 'Locked' }, { status: 403 });
  }
  const { id } = await params;
  await deletePlaylist(id);
  return NextResponse.json({ ok: true });
}
