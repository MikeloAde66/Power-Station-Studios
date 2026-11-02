import { NextRequest, NextResponse } from 'next/server';
import { UNLOCK_COOKIE_NAME, verifyUnlockToken } from '@/lib/access';

// The client calls this on load to find out whether this browser is
// unlocked — the cookie is HttpOnly (JS can't read it directly, by design),
// and its signature is re-checked here on every call rather than trusted.
//
// Local dev (`npm run dev`) always comes back unlocked, so Mike can keep
// loading and playing his own songs on his own machine without a purchase.
// `next build`/`next start` and every deployed Vercel environment run with
// NODE_ENV === 'production', so the public site is never affected by this.
export async function GET(req: NextRequest) {
  if (process.env.NODE_ENV !== 'production') {
    return NextResponse.json({ unlocked: true });
  }
  const token = req.cookies.get(UNLOCK_COOKIE_NAME)?.value;
  return NextResponse.json({ unlocked: verifyUnlockToken(token) });
}
