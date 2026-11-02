import { createHmac, timingSafeEqual } from 'crypto';

// Signs a lightweight, server-verifiable "you paid for this" token so the
// unlock cookie can't just be typed into devtools by someone who didn't buy
// anything. The signature is checked on every gated request (cheap, no
// network call back to Stripe needed) using a secret that only lives in
// this server's environment, never in the browser or in this repo.
//
// COOKIE_SECRET must be set in the deployment's environment variables
// (Vercel project settings -> Environment Variables), not committed here.
// Generate one locally with: openssl rand -hex 32

const COOKIE_NAME = 'pt_unlocked';

function getSecret(): string {
  const secret = process.env.COOKIE_SECRET;
  if (!secret) {
    throw new Error(
      'COOKIE_SECRET is not set. Add it in the Vercel project’s Environment Variables (generate one with: openssl rand -hex 32).'
    );
  }
  return secret;
}

function sign(value: string): string {
  return createHmac('sha256', getSecret()).update(value).digest('hex');
}

// Token shape: "<stripe checkout session id>.<hmac signature>"
export function createUnlockToken(sessionId: string): string {
  return `${sessionId}.${sign(sessionId)}`;
}

export function verifyUnlockToken(token: string | undefined | null): boolean {
  if (!token) return false;
  const dot = token.lastIndexOf('.');
  if (dot <= 0) return false;
  const sessionId = token.slice(0, dot);
  const signature = token.slice(dot + 1);
  const expected = sign(sessionId);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export const UNLOCK_COOKIE_NAME = COOKIE_NAME;
// One year — a purchase shouldn't need re-verifying every session.
export const UNLOCK_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;
