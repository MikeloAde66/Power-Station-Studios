import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { createUnlockToken, UNLOCK_COOKIE_MAX_AGE, UNLOCK_COOKIE_NAME } from '@/lib/access';

// Verifies a Stripe Checkout session server-side (never trusts anything the
// browser claims) and, only if it actually paid, sets the signed unlock
// cookie. STRIPE_SECRET_KEY must be set in Vercel's Environment Variables
// (the Stripe Dashboard's "Developers -> API keys" page, secret key) —
// never commit it here, never paste it into chat.

export async function GET(req: NextRequest) {
  const sessionId = req.nextUrl.searchParams.get('session_id');
  if (!sessionId) {
    return NextResponse.json({ unlocked: false, error: 'Missing session_id' }, { status: 400 });
  }

  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) {
    return NextResponse.json(
      { unlocked: false, error: 'Server is not configured (STRIPE_SECRET_KEY missing).' },
      { status: 500 }
    );
  }

  try {
    const stripe = new Stripe(secretKey);
    const session = await stripe.checkout.sessions.retrieve(sessionId);

    const paid = session.payment_status === 'paid';
    if (!paid) {
      return NextResponse.json({ unlocked: false, error: 'This session has not been paid.' }, { status: 402 });
    }

    const response = NextResponse.json({ unlocked: true });
    response.cookies.set({
      name: UNLOCK_COOKIE_NAME,
      value: createUnlockToken(session.id),
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      maxAge: UNLOCK_COOKIE_MAX_AGE,
      path: '/',
    });
    return response;
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ unlocked: false, error: `Could not verify session: ${message}` }, { status: 400 });
  }
}
