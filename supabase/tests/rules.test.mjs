// Runs the Myrs schema migration on PGlite (Postgres in WebAssembly) with a
// minimal Supabase stub (roles, auth.uid(), auth.users) and checks the point
// rules and row level security. Run with: npm run test:sql
import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const schema = fs.readFileSync(path.join(here, '../migrations/20261119000001_schema.sql'), 'utf8');
const db = new PGlite();

await db.exec(`
  create role anon nologin; create role authenticated nologin; create role service_role nologin;
  create schema auth;
  create table auth.users (id uuid primary key, phone text, email text);
  create function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant usage on schema auth to anon, authenticated;
  grant execute on function auth.uid() to anon, authenticated;
  grant usage on schema public to anon, authenticated;
  create publication supabase_realtime;
`);
await db.exec(schema);
console.log('migration applied');

let failures = 0;
const check = (cond, label) => {
  if (cond) console.log('  ok  ', label);
  else {
    failures++;
    console.log('  FAIL', label);
  }
};

async function as(uid, sql, params = []) {
  return db.transaction(async (tx) => {
    await tx.query(`select set_config('request.jwt.claim.sub', $1, true)`, [uid ?? '']);
    await tx.exec(`set local role ${uid ? 'authenticated' : 'anon'}`);
    return (await tx.query(sql, params)).rows;
  });
}
async function err(uid, sql, params = []) {
  try {
    await as(uid, sql, params);
    return null;
  } catch (e) {
    return e.message;
  }
}
const one = async (uid, sql, params) => (await as(uid, sql, params))[0];
const su = async (sql, params = []) => (await db.query(sql, params)).rows;
const bal = async (u) => (await su(`select private.balance($1) b`, [u]))[0].b;

const A = '00000000-0000-0000-0000-00000000000a';
const B = '00000000-0000-0000-0000-00000000000b';
const C = '00000000-0000-0000-0000-00000000000c';
const D = '00000000-0000-0000-0000-00000000000d';
const ADM = '00000000-0000-0000-0000-0000000000ad';
await su(`insert into auth.users values
  ('${A}', '886911111111', null), ('${B}', '886922222222', null), ('${C}', null, 'c@example.com'),
  ('${D}', '886944444444', null), ('${ADM}', '886900000000', null)`);

console.log('signup');
for (const [u, n] of [[A, '阿美'], [B, '阿寶'], [C, '小西'], [D, '阿丁'], [ADM, '管理員']]) {
  const r = await one(u, `select complete_signup($1) r`, [n]);
  check(r.r.bonus === 50, `${n} gets 50 signup points`);
}
check((await err(B, `select complete_signup('again')`))?.includes('已經註冊過'), 'cannot sign up twice');
check((await err(null, `select complete_signup('anon')`))?.includes('permission denied'), 'anon cannot call RPCs');
await su(`update profiles set role = 'admin' where id = '${ADM}'`);

console.log('direct writes are blocked');
check((await err(B, `insert into ledger (user_id, type, amount) values ('${B}', 'adjust', 1000)`))?.includes('permission denied'), 'cannot insert ledger');
check((await err(B, `update profiles set role = 'admin' where id = '${B}'`))?.includes('permission denied'), 'cannot promote self');
check((await err(B, `select * from signup_grants`))?.includes('permission denied'), 'cannot read signup_grants');
check((await err(B, `select private.add_ledger('${B}', 'adjust', 1000, 'x')`))?.includes('permission denied'), 'cannot call private helpers');

console.log('listing');
const food = (extra = {}) =>
  JSON.stringify({
    category: 'food', sub: '即期品', title: '吐司兩條', description: '明天到期', quantity: 1,
    mode: 'points', pricePoints: 20, swapWish: '', expiresOn: '2099-01-01', storage: '常溫',
    photos: [], location: { lat: 25.03, lng: 121.53 }, areaLabel: '大安站', timeSlots: '晚上', ...extra,
  });
check((await err(A, `select create_listing($1::jsonb)`, [food({ expiresOn: '2000-01-01' })]))?.includes('到期日'), 'rejects past expiry');
check((await err(A, `select create_listing($1::jsonb)`, [food({ photos: ['data:image/png;base64,xx'] })]))?.includes('照片'), 'rejects data URL photos');
const L1 = (await one(A, `select create_listing($1::jsonb) r`, [food()])).r;
check(L1.status === 'active' && L1.reward === 20, 'first listing active, +20 reward');
check((await bal(A)) === 70, 'A balance 70');
const L2 = (await one(A, `select create_listing($1::jsonb) r`, [food({ title: '自製啤酒', category: 'clothing' })])).r;
check(L2.status === 'pending_review' && L2.reward === 0, 'banned word goes to review, no second reward');
const pub = await one(null, `select lat, lng from listings where id = $1`, [L1.id]);
const sec = (await su(`select lat, lng from listing_secrets where listing_id = $1`, [L1.id]))[0];
const moved = Math.hypot((pub.lat - sec.lat) * 111320, (pub.lng - sec.lng) * 111320 * Math.cos((25.03 * Math.PI) / 180));
check(moved >= 59 && moved <= 181, `public point is fuzzed (${moved.toFixed(0)} m)`);
check((await as(null, `select * from listings where id = $1`, [L2.id])).length === 0, 'anon cannot see pending listing');
check((await as(null, `select * from listing_secrets`)).length === 0, 'anon cannot see exact locations');
check((await as(B, `select * from listing_secrets`)).length === 0, 'B cannot see exact location yet');
check((await as(A, `select * from listing_secrets`)).length === 2, 'owner sees own exact locations');

console.log('points order');
check((await err(A, `select request_listing($1, '', '')`, [L1.id]))?.includes('自己'), 'cannot request own listing');
const O1 = (await one(B, `select request_listing($1, '想要', '') r`, [L1.id])).r;
check((await bal(B)) === 30, 'B holds 20 → 30 available');
check((await err(B, `select request_listing($1, '', '')`, [L1.id]))?.includes('索取過'), 'no duplicate request');
check((await as(C, `select * from orders`)).length === 0, 'C cannot see the order');
check((await err(B, `select accept_order($1)`, [O1]))?.includes('找不到'), 'requester cannot accept');
await as(A, `select accept_order($1)`, [O1]);
check((await as(B, `select * from listing_secrets`)).length === 1, 'B sees exact location after accept');
check((await as(B, `select body from messages where order_id = $1`, [O1])).length === 2, 'note + system message in chat');
check((await as(C, `select * from messages`)).length === 0, 'C cannot read the chat');
check((await one(null, `select status from listings where id = $1`, [L1.id]))?.status === 'reserved', 'listing reserved');
await as(B, `select send_message($1, '晚上七點？', null)`, [O1]);
check((await err(C, `select send_message($1, 'hi', null)`, [O1]))?.includes('無法'), 'C cannot send to the chat');
check((await one(B, `select mark_done($1) r`, [O1])).r === false, 'B confirms, waiting');
check((await one(A, `select mark_done($1) r`, [O1])).r === true, 'A confirms, completed');
check((await bal(A)) === 70 + 20 - 2 + 30, `A gets 20 − 2 fee + 30 first order = 118 (${await bal(A)})`);
check((await bal(B)) === 30 + 30, `B gets first order reward = 60 (${await bal(B)})`);
check((await su(`select status from listings where id = $1`, [L1.id]))[0].status === 'closed', 'listing closed');

console.log('blind reviews');
await as(B, `select submit_review($1, 5, '很準時')`, [O1]);
check((await as(A, `select * from reviews`)).length === 0, 'A cannot see B review yet');
check((await as(B, `select * from reviews`)).length === 1, 'B sees own review');
await as(A, `select submit_review($1, 4, '')`, [O1]);
check((await as(C, `select * from reviews`)).length === 2, 'both published once both reviewed');
check((await err(A, `select submit_review($1, 4, '')`, [O1]))?.includes('評價過'), 'one review per side');

console.log('free order, love score, daily limit');
const free = (t) => food({ title: t, mode: 'free', pricePoints: 0, quantity: 5 });
const F = [];
for (const t of ['蘋果一袋', '香蕉一串', '橘子一箱', '芭樂兩顆']) F.push((await one(A, `select create_listing($1::jsonb) r`, [free(t)])).r.id);
const fo = [];
for (let i = 0; i < 3; i++) fo.push((await one(C, `select request_listing($1, '', '') r`, [F[i]])).r);
check((await err(C, `select request_listing($1, '', '')`, [F[3]]))?.includes('每天最多 3'), 'free daily limit 3');
await as(A, `select accept_order($1)`, [fo[0]]);
await as(A, `select mark_done($1)`, [fo[0]]);
await as(C, `select mark_done($1)`, [fo[0]]);
check((await su(`select love_score from profiles where id = '${A}'`))[0].love_score === 1, 'free gift adds love point');
check((await one(A, `select remaining, status from listings where id = $1`, [F[0]])).remaining === 4, 'remaining decremented');

console.log('timeouts');
await su(`update orders set created_at = now() - interval '25 hours' where id = $1`, [fo[1]]);
const O2 = (await one(B, `select request_listing($1, '', '') r`, [
  (await one(A, `select create_listing($1::jsonb) r`, [food({ title: '牛奶', pricePoints: 10 })])).r.id,
])).r;
await as(A, `select accept_order($1)`, [O2]);
await as(B, `select mark_done($1)`, [O2]);
await su(`update orders set requester_done_at = now() - interval '49 hours' where id = $1`, [O2]);
const before = await bal(A);
check((await one(B, `select run_maintenance() r`)).r === true, 'maintenance reports changes');
check((await su(`select status from orders where id = $1`, [fo[1]]))[0].status === 'cancelled', '24 h request timeout cancels');
check((await su(`select status from orders where id = $1`, [O2]))[0].status === 'completed', '48 h auto-complete');
check((await bal(A)) === before + 10 - 1, 'auto-complete pays 10 − 1 fee');
check((await one(B, `select run_maintenance() r`)).r === false, 'second run is a no-op');

console.log('cancel refunds');
const L3 = (await one(A, `select create_listing($1::jsonb) r`, [food({ title: '優格', pricePoints: 5 })])).r.id;
const b0 = await bal(B);
const O3 = (await one(B, `select request_listing($1, '', '') r`, [L3])).r;
check((await bal(B)) === b0 - 5, 'hold 5');
await as(A, `select decline_order($1, '已送出')`, [O3]);
check((await bal(B)) === b0, 'decline releases the hold');

console.log('reports');
const L4 = (await one(A, `select create_listing($1::jsonb) r`, [food({ title: '可疑商品' })])).r.id;
check((await one(B, `select report('listing', $1, '疑似詐騙') r`, [L4])).r === false, 'report 1');
check((await err(B, `select report('listing', $1, '再一次')`, [L4]))?.includes('檢舉過'), 'one open report per user');
await as(C, `select report('listing', $1, '疑似詐騙')`, [L4]);
check((await one(D, `select report('listing', $1, '疑似詐騙') r`, [L4])).r === true, '3rd reporter hides it');
check((await as(D, `select * from reports`)).length === 1, 'reporter sees only own report');
check((await as(ADM, `select * from reports where target_id = $1`, [L4])).length === 3, 'admin sees all reports');
const rp = (await as(ADM, `select id from reports where target_id = $1 limit 1`, [L4]))[0].id;
await as(ADM, `select admin_handle_report($1, 'dismiss')`, [rp]);
check((await su(`select status from listings where id = $1`, [L4]))[0].status === 'active', 'dismiss restores listing');

console.log('blocks');
check((await one(B, `select toggle_block($1) r`, [A])).r === true, 'B blocks A');
const LB = (await one(A, `select create_listing($1::jsonb) r`, [food({ title: '封鎖後刊登' })])).r.id;
check((await as(B, `select * from listings where id = $1`, [LB])).length === 0, 'B cannot see A new listing');
check((await as(A, `select * from blocks`)).length === 0, 'A cannot see who blocked them');
check((await err(B, `select request_listing($1, '', '')`, [L4]))?.includes('封鎖'), 'blocked request refused');
check((await one(B, `select toggle_block($1) r`, [A])).r === false, 'B unblocks A');

console.log('disputes and admin');
const L5 = (await one(A, `select create_listing($1::jsonb) r`, [food({ title: '果醬', pricePoints: 10 })])).r.id;
const O5 = (await one(B, `select request_listing($1, '', '') r`, [L5])).r;
await as(A, `select accept_order($1)`, [O5]);
await as(B, `select open_dispute($1, '東西壞了')`, [O5]);
check((await err(B, `select admin_resolve_dispute($1, 'refund', '')`, [O5]))?.includes('管理員'), 'members cannot resolve');
const b1 = await bal(B);
await as(ADM, `select admin_resolve_dispute($1, 'refund', '確認損壞')`, [O5]);
check((await bal(B)) === b1 + 10, 'refund releases 10 points');
check((await su(`select remaining, status from listings where id = $1`, [L5]))[0].status === 'active', 'refund restocks');
await as(ADM, `select admin_adjust_points($1, 15, '補償')`, [C]);
check((await err(ADM, `select admin_adjust_points($1, -100000, 'x')`, [C]))?.includes('小於 0'), 'adjust cannot go negative');
await as(ADM, `select admin_update_settings('{"feeRate": 0.2, "freeDailyLimit": 5}')`);
const st = (await su(`select fee_rate, free_daily_limit from settings`))[0];
check(st.fee_rate === 0.2 && st.free_daily_limit === 5, 'settings updated from camelCase');
check((await err(ADM, `select admin_update_settings('{"feeRate": 0.9}')`))?.includes('50%'), 'fee cap 50%');
check((await err(ADM, `select admin_update_settings('{"freeDailyLimit": 2.5}')`))?.includes('整數'), 'integer settings');
check((await err(ADM, `select admin_update_settings('{"hack": 1}')`))?.includes('沒有'), 'unknown setting refused');
check((await as(ADM, `select * from admin_log`)).length >= 4, 'admin log written');
check((await as(B, `select * from admin_log`)).length === 0, 'members cannot read admin log');
await as(ADM, `select admin_set_user_status($1, 'suspended')`, [D]);
check((await err(D, `select update_profile('x', '')`))?.includes('停權'), 'suspended user blocked');

console.log('ledger visibility and anti-farming');
check((await as(B, `select distinct user_id from ledger`)).every((r) => r.user_id === B), 'B sees only own ledger');
for (let i = 0; i < 3; i++) {
  const l = (await one(A, `select create_listing($1::jsonb) r`, [food({ title: `餅乾${i}`, pricePoints: 1 })])).r.id;
  const o = (await one(C, `select request_listing($1, '', '') r`, [l])).r;
  await as(A, `select accept_order($1)`, [o]);
  await as(A, `select mark_done($1)`, [o]);
  await as(C, `select mark_done($1)`, [o]);
}
check((await su(`select count(*)::int n from reports where reporter_id is null and target_id = '${C}'`))[0].n === 1, 'repeated pair flagged once');

console.log('account deletion');
await as(C, `select delete_account()`);
const pc = (await su(`select status, name from profiles where id = '${C}'`))[0];
check(pc.status === 'deleted' && pc.name === '已刪除的使用者', 'profile tombstoned');
check((await su(`select count(*)::int n from auth.users where id = '${C}'`))[0].n === 0, 'auth user removed');
await su(`insert into auth.users values ('00000000-0000-0000-0000-0000000000c2', null, 'C@example.com')`);
const again = await one('00000000-0000-0000-0000-0000000000c2', `select complete_signup('小西2') r`);
check(again.r.bonus === 0, 'same email does not get the signup bonus again');

const sum = (await su(`select sum(amount)::int s from ledger where type in ('signup_bonus','reward','adjust')`))[0].s;
const fees = (await su(`select -sum(amount)::int s from ledger where type = 'fee'`))[0].s;
const circ = (await su(`select sum(amount)::int s from ledger`))[0].s;
const held = (await su(`select coalesce(sum(points),0)::int s from orders where mode='points' and status in ('requested','accepted','disputed')`))[0].s;
check(sum - fees === circ + held, `points conserved: issued ${sum} − fees ${fees} = available ${circ} + held ${held}`);

console.log(failures ? `\n${failures} FAILED` : '\nall checks passed');
process.exit(failures ? 1 : 0);
