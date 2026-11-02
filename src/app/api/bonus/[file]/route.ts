import { NextRequest, NextResponse } from 'next/server';
import { readFile } from 'fs/promises';
import path from 'path';
import { UNLOCK_COOKIE_NAME, verifyUnlockToken } from '@/lib/access';

// Bonus tracks live outside /public on purpose — anything under /public is
// served to anyone who guesses the URL, paid or not. This route is the only
// way to reach them, and it checks the signed unlock cookie server-side
// before it will read a single byte off disk.

const BONUS_TRACKS: Record<string, { file: string; title: string }> = {
  'westcoast-e.mp3': { file: 'westcoast-e.mp3', title: 'Westcoast E' },
  'spice.mp3': { file: 'spice.mp3', title: 'Spice' },
  'new-york-vibe-rock.mp3': { file: 'new-york-vibe-rock.mp3', title: 'New York Vibe Rock' },
};

export async function GET(req: NextRequest, { params }: { params: Promise<{ file: string }> }) {
  const token = req.cookies.get(UNLOCK_COOKIE_NAME)?.value;
  if (!verifyUnlockToken(token)) {
    return NextResponse.json({ error: 'Purchase required.' }, { status: 403 });
  }

  const { file } = await params;
  const track = BONUS_TRACKS[file];
  if (!track) {
    return NextResponse.json({ error: 'Not found.' }, { status: 404 });
  }

  const filePath = path.join(process.cwd(), 'private-assets', 'bonus', track.file);
  try {
    const bytes = await readFile(filePath);
    return new NextResponse(new Uint8Array(bytes), {
      headers: {
        'Content-Type': 'audio/mpeg',
        'Content-Disposition': `attachment; filename="${track.title}.mp3"`,
        'Cache-Control': 'private, no-store',
      },
    });
  } catch {
    return NextResponse.json({ error: 'File unavailable.' }, { status: 500 });
  }
}
