import { NextRequest, NextResponse } from 'next/server';
import { createUnlockToken, UNLOCK_COOKIE_MAX_AGE, UNLOCK_COOKIE_NAME } from '@/lib/access';

// Owner-only door around the purchase gate. Mike is the person this whole
// product is built for — he can't be stuck behind the same lock a paying
// customer has to clear, especially mid-build when there's no finished
// Stripe flow to run a real (or test) purchase through yet.
//
// Visiting this URL with the right `key` sets the exact same signed
// `pt_unlocked` cookie a real purchase would, through the exact same
// code path (createUnlockToken) — it does not touch Stripe, does not
// pretend a sale happened, and isn't reachable without OWNER_UNLOCK_KEY,
// which only lives in Vercel's environment variables (set once, known
// only to Mike and this session — never committed to the repo).
//
// This route makes no sales claim and performs no transaction — it's a
// developer/owner backdoor, the same category of thing most products
// ship internally during build-out. Keep the URL private: anyone who has
// it can unlock a browser for free.
export async function GET(req: NextRequest) {
  const key = req.nextUrl.searchParams.get('key');
  const expected = process.env.OWNER_UNLOCK_KEY;

  if (!expected) {
    return NextResponse.json({ error: 'OWNER_UNLOCK_KEY is not configured.' }, { status: 500 });
  }
  if (!key || key !== expected) {
    return NextResponse.json({ error: 'Not authorized.' }, { status: 403 });
  }

  const response = NextResponse.redirect(new URL('/', req.url));
  response.cookies.set({
    name: UNLOCK_COOKIE_NAME,
    value: createUnlockToken('owner-manual-unlock'),
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    maxAge: UNLOCK_COOKIE_MAX_AGE,
    path: '/',
  });
  return response;
}
