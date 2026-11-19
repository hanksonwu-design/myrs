/**
 * Which data layer the app runs on.
 *   - supabase: NEXT_PUBLIC_SUPABASE_URL and a public key are set (real accounts, shared data).
 *   - local:    neither is set; everything lives in this browser's localStorage (demo mode).
 */
export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
export const SUPABASE_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

export const IS_REMOTE = Boolean(SUPABASE_URL && SUPABASE_KEY);

/** Login methods shown on /login in Supabase mode. Phone needs an SMS provider in Supabase. */
export const LOGIN_METHODS = (process.env.NEXT_PUBLIC_LOGIN_METHODS || 'email')
  .split(',')
  .map((s) => s.trim())
  .filter((m): m is 'phone' | 'email' => m === 'phone' || m === 'email');
