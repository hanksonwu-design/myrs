// End-to-end check against the real Supabase project in web/.env.local.
// Uses temporary anonymous sign-ins (turn "Allow anonymous sign-ins" on only
// while testing), so it exercises the real API, RLS, storage and realtime.
// Test users are named "E2E…"; remove them afterwards with supabase/cleanup_e2e.sql.
// Run with: npm run test:e2e
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';

const here = path.dirname(fileURLToPath(import.meta.url));
const env = Object.fromEntries(
  fs
    .readFileSync(path.join(here, '../../.env.local'), 'utf8')
    .split(/\r?\n/)
    .filter((l) => /^[A-Z_]+=/.test(l))
    .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]),
);
const URL = env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (!URL || !KEY) throw new Error('web/.env.local needs the Supabase URL and key');

let failures = 0;
const check = (cond, label) => {
  console.log(cond ? '  ok  ' : '  FAIL', label);
  if (!cond) failures++;
};
const client = () => createClient(URL, KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const run = Date.now().toString(36).slice(-4);

async function member(name) {
  const c = client();
  const { data, error } = await c.auth.signInAnonymously();
  if (error) throw new Error(`anonymous sign-in failed: ${error.message}`);
  const r = await c.rpc('complete_signup', { p_name: `${name}${run}` });
  if (r.error) throw new Error(`complete_signup: ${r.error.message}`);
  return { c, id: data.user.id, bonus: r.data.bonus };
}
const rpc = async (m, fn, args) => {
  const r = await m.c.rpc(fn, args);
  if (r.error) throw new Error(`${fn}: ${r.error.message}`);
  return r.data;
};
const rpcErr = async (m, fn, args) => (await m.c.rpc(fn, args)).error?.message ?? null;
const balance = async (m) => {
  const { data } = await m.c.from('ledger').select('amount');
  return data.reduce((s, e) => s + e.amount, 0);
};
const JPEG = Buffer.from(
  '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=',
  'base64',
);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

console.log('sign-up');
const A = await member('E2E提供者');
const B = await member('E2E索取者');
const C = await member('E2E路人');
check(A.bonus === 50 && B.bonus === 50, 'new members get 50 points');
check((await balance(B)) === 50, 'balance comes from the ledger');
check((await rpcErr(A, 'complete_signup', { p_name: 'again' }))?.includes('已經註冊過'), 'cannot sign up twice');

console.log('direct writes are blocked');
const ins = await B.c.from('ledger').insert({ user_id: B.id, type: 'adjust', amount: 999 });
check(!!ins.error, 'cannot insert into ledger');
const upd = await B.c.from('profiles').update({ role: 'admin' }).eq('id', B.id).select();
check(!!upd.error || upd.data.length === 0, 'cannot make self admin');

console.log('photo upload');
const photoPath = `${A.id}/e2e-${run}.jpg`;
const up = await A.c.storage.from('listing-photos').upload(photoPath, JPEG, { contentType: 'image/jpeg' });
check(!up.error, `owner uploads to own folder ${up.error?.message ?? ''}`);
const photoUrl = A.c.storage.from('listing-photos').getPublicUrl(photoPath).data.publicUrl;
check((await fetch(photoUrl)).status === 200, 'photo is publicly readable');
const wrong = await A.c.storage.from('listing-photos').upload(`${B.id}/hack-${run}.jpg`, JPEG, { contentType: 'image/jpeg' });
check(!!wrong.error, 'cannot upload into another user folder');

console.log('listing');
const listing = await rpc(A, 'create_listing', {
  p: {
    category: 'food', sub: '即期品', title: 'E2E 測試吐司', description: '自動測試資料', quantity: 1,
    mode: 'points', pricePoints: 20, swapWish: '', expiresOn: '2099-01-01', storage: '常溫',
    photos: [photoUrl], location: { lat: 25.0296, lng: 121.5357 }, areaLabel: '大安森林公園', timeSlots: '晚上',
  },
});
check(listing.status === 'active' && listing.reward === 20, 'listing active with first-listing reward');
const anon = client();
const seen = await anon.from('listings').select('id, lat, lng, photos').eq('id', listing.id);
check(seen.data?.length === 1 && seen.data[0].photos[0] === photoUrl, 'visitors see the listing and photo');
check(((await anon.from('listing_secrets').select('*')).data ?? []).length === 0, 'visitors cannot see exact locations');
check(((await B.c.from('listing_secrets').select('*')).data ?? []).length === 0, 'B cannot see the exact location yet');

console.log('realtime');
let events = 0;
// Wait for the server's "Subscribed to PostgreSQL" message, not just SUBSCRIBED:
// changes made before it arrives are not delivered.
const ready = new Promise((resolve) => {
  const channel = A.c
    .channel(`e2e-${run}`)
    .on('system', {}, (p) => p.extension === 'postgres_changes' && p.status === 'ok' && resolve(channel))
    .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, () => {
      events++;
    });
  channel.subscribe();
});
const channel = await Promise.race([ready, wait(10000).then(() => null)]);
check(channel !== null, 'realtime subscription ready');

console.log('points order');
const orderId = await rpc(B, 'request_listing', { p_listing: listing.id, p_note: '晚上可以嗎？', p_swap_offer: '' });
check((await balance(B)) === 30, 'B holds 20 points');
await wait(2500);
check(events > 0, `provider gets a realtime event (${events})`);
check(((await C.c.from('orders').select('id')).data ?? []).length === 0, 'C cannot see the order');
check((await rpcErr(C, 'accept_order', { p_order: orderId }))?.includes('找不到'), 'C cannot accept');
await rpc(A, 'accept_order', { p_order: orderId });
check(((await B.c.from('listing_secrets').select('*')).data ?? []).length === 1, 'B sees the exact location after accept');

console.log('chat with photo');
const chatPath = `${orderId}/e2e-${run}.jpg`;
const cu = await B.c.storage.from('chat-images').upload(chatPath, JPEG, { contentType: 'image/jpeg' });
check(!cu.error, `party uploads chat photo ${cu.error?.message ?? ''}`);
await rpc(B, 'send_message', { p_order: orderId, p_body: '我到了', p_image: chatPath });
const signedA = await A.c.storage.from('chat-images').createSignedUrl(chatPath, 60);
check(!!signedA.data && (await fetch(signedA.data.signedUrl)).status === 200, 'other party can open the chat photo');
const signedC = await C.c.storage.from('chat-images').createSignedUrl(chatPath, 60);
check(!signedC.data, 'outsider cannot open the chat photo');
const cuC = await C.c.storage.from('chat-images').upload(`${orderId}/c-${run}.jpg`, JPEG, { contentType: 'image/jpeg' });
check(!!cuC.error, 'outsider cannot upload into the chat');
const msgs = (await A.c.from('messages').select('body').eq('order_id', orderId)).data ?? [];
check(msgs.length >= 3, `both sides see the chat (${msgs.length} messages)`);
check(((await C.c.from('messages').select('id')).data ?? []).length === 0, 'C cannot read the chat');

console.log('complete');
check((await rpc(B, 'mark_done', { p_order: orderId })) === false, 'B confirms');
check((await rpc(A, 'mark_done', { p_order: orderId })) === true, 'A confirms, completed');
check((await balance(A)) === 50 + 20 + 20 - 2 + 30, `A: 50 + 20 listing + 20 − 2 fee + 30 first order = 118 (${await balance(A)})`);
check((await balance(B)) === 30 + 30, `B: 30 + 30 first order = 60 (${await balance(B)})`);

console.log('blind reviews');
await rpc(B, 'submit_review', { p_order: orderId, p_stars: 5, p_comment: '準時' });
check(((await A.c.from('reviews').select('id').eq('order_id', orderId)).data ?? []).length === 0, 'A cannot see the review yet');
await rpc(A, 'submit_review', { p_order: orderId, p_stars: 5, p_comment: '' });
check(((await anon.from('reviews').select('id').eq('order_id', orderId)).data ?? []).length === 2, 'both reviews public');

console.log('maintenance');
const m = await A.c.rpc('run_maintenance');
check(!m.error, 'members can trigger the time-based rules');
check(!!(await anon.rpc('run_maintenance')).error, 'visitors cannot');

if (channel) await A.c.removeChannel(channel);
console.log(failures ? `\n${failures} FAILED` : '\nall checks passed');
console.log(`test users: E2E提供者${run}, E2E索取者${run}, E2E路人${run}`);
process.exit(failures ? 1 : 0);
