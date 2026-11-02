import { NextRequest, NextResponse } from 'next/server';
import { UNLOCK_COOKIE_NAME, verifyUnlockToken } from '@/lib/access';

// The client calls this on load to find out whether this browser is
// unlocked — the cookie is HttpOnly (JS can't read it directly, by design),
// and its signature is re-checked here on every call rather than trusted.
export async function GET(req: NextRequest) {
  const token = req.cookies.get(UNLOCK_COOKIE_NAME)?.value;
  return NextResponse.json({ unlocked: verifyUnlockToken(token) });
}
