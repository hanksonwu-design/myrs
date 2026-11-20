// Runs the Myrs schema migration on PGlite (Postgres in WebAssembly) with a
// minimal Supabase stub (roles, auth.uid(), auth.users) and checks the point
// rules and row level security. Run with: npm run test:sql
import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
// Storage (002), pg_cron (003) and pg_net (005) need Supabase extensions, so they are skipped here.
const migration = (name) => fs.readFileSync(path.join(here, '../migrations', name), 'utf8');
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
await db.exec(migration('20261119000001_schema.sql'));
await db.exec(migration('20261119000004_review_fixes.sql'));
await db.exec(migration('20261119000006_improvements.sql'));
await db.exec(migration('20261120000007_admin_levels.sql'));
await db.exec(migration('20261120000008_admin_tools.sql'));
console.log('migrations applied');

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
await as(ADM, `select admin_set_user_status($1, 'suspended', '測試停權')`, [D]);
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

console.log('one reward per person (e-mail aliases)');
const E1 = '00000000-0000-0000-0000-0000000000e1';
const E2 = '00000000-0000-0000-0000-0000000000e2';
const E3 = '00000000-0000-0000-0000-0000000000e3';
await su(`insert into auth.users values ('${E1}', null, 'Mei.Lin@gmail.com'), ('${E2}', null, 'meilin+2@gmail.com'), ('${E3}', null, 'mei.lin+x@googlemail.com')`);
check((await one(E1, `select complete_signup('美玲') r`)).r.bonus === 50, 'first address gets the signup bonus');
check((await one(E2, `select complete_signup('美玲2') r`)).r.bonus === 0, 'gmail +alias gets no signup bonus');
check((await one(E3, `select complete_signup('美玲3') r`)).r.bonus === 0, 'googlemail dotted alias gets no signup bonus');
const cloth = (t) => food({ title: t, category: 'clothing', mode: 'free', pricePoints: 0 });
check((await one(E1, `select create_listing($1::jsonb) r`, [cloth('洋裝')])).r.reward === 20, 'first listing reward once');
check((await one(E2, `select create_listing($1::jsonb) r`, [cloth('短裙')])).r.reward === 0, 'alias gets no first listing reward');
const LE = (await one(E1, `select create_listing($1::jsonb) r`, [cloth('圍巾')])).r.id;
const OE = (await one(E2, `select request_listing($1, '', '') r`, [LE])).r;
await as(E1, `select accept_order($1)`, [OE]);
await as(E1, `select mark_done($1)`, [OE]);
await as(E2, `select mark_done($1)`, [OE]);
check((await su(`select count(*)::int n from ledger where user_id in ('${E1}', '${E2}') and note = '首次完成交易獎勵'`))[0].n === 1, 'one first deal reward for both aliases together');
check((await err(E1, `select * from reward_grants`))?.includes('permission denied'), 'cannot read reward_grants');

console.log('e-mail notifications');
const mail = async (u) => su(`select subject, body, link from notifications where user_id = $1 order by created_at, subject`, [u]);
await su(`delete from notifications`);
const LN = (await one(A, `select create_listing($1::jsonb) r`, [food({ title: '鳳梨酥', pricePoints: 10 })])).r.id;
const ON = (await one(B, `select request_listing($1, '可以晚上拿嗎', '') r`, [LN])).r;
let m = await mail(A);
check(m.length === 1 && m[0].subject.includes('想索取') && m[0].body.includes('可以晚上拿嗎') && m[0].link === '/orders?tab=provide', 'provider mailed on request');
check((await mail(B)).length === 0, 'requester not mailed for own request');
await as(A, `select accept_order($1)`, [ON]);
m = await mail(B);
check(m.length === 1 && m[0].subject.includes('接受') && m[0].link.endsWith(ON), 'requester mailed on accept');
await as(A, `select mark_done($1)`, [ON]);
m = await mail(B);
check(m.length === 2 && m.some((x) => x.body.includes('提出爭議') && x.body.includes('10 點')), 'requester warned when provider confirms first');
await as(B, `select mark_done($1)`, [ON]);
check((await mail(A)).some((x) => x.subject === '「鳳梨酥」交易完成'), 'first confirmer mailed when the deal completes');
check(!(await mail(B)).some((x) => x.subject === '「鳳梨酥」交易完成'), 'last confirmer not mailed');
check((await err(B, `select * from notifications`))?.includes('permission denied'), 'clients cannot read notifications');
check((await err(B, `select private.notify($1, 'x', 'y')`, [B]))?.includes('permission denied'), 'clients cannot queue mail');
const claimed = await su(`select * from private.claim_notifications(100)`);
check(claimed.length > 0 && claimed.every((x) => 'email' in x), 'sender claims queued mail with addresses');
check((await su(`select * from private.claim_notifications(100)`)).length === 0, 'claimed mail is not handed out twice');
for (const x of claimed) await su(`select private.finish_notification($1, true, '')`, [x.id]);
check((await su(`select count(*)::int n from notifications where sent_at is null`))[0].n === 0, 'finished mail marked sent');

console.log('accepted deals nobody confirms');
const LS = (await one(A, `select create_listing($1::jsonb) r`, [food({ title: '鳳梨乾', pricePoints: 12 })])).r.id;
const OS = (await one(B, `select request_listing($1, '', '') r`, [LS])).r;
await as(A, `select accept_order($1)`, [OS]);
const bs = await bal(B);
await su(`delete from notifications`);
await su(`update orders set accepted_at = now() - interval '5 days 1 hour' where id = $1`, [OS]);
await su(`select private.run_maintenance()`);
check((await su(`select reminded_at from orders where id = $1`, [OS]))[0].reminded_at !== null, 'reminder after 5 days');
check((await mail(A)).length === 1 && (await mail(B)).length === 1, 'both sides mailed a reminder');
check((await su(`select status from orders where id = $1`, [OS]))[0].status === 'accepted', 'still open after reminder');
await su(`update orders set accepted_at = now() - interval '7 days 1 hour' where id = $1`, [OS]);
await su(`select private.run_maintenance()`);
check((await su(`select status from orders where id = $1`, [OS]))[0].status === 'cancelled', 'cancelled after 7 days');
check((await bal(B)) === bs + 12, 'frozen points refunded');
check((await mail(B)).some((x) => x.body.includes('12 點已退回')), 'requester mailed about the refund');
await as(ADM, `select admin_update_settings('{"acceptTimeoutDays": 0}')`);
const LS2 = (await one(A, `select create_listing($1::jsonb) r`, [food({ title: '蛋捲', pricePoints: 3 })])).r.id;
const OS2 = (await one(B, `select request_listing($1, '', '') r`, [LS2])).r;
await as(A, `select accept_order($1)`, [OS2]);
await su(`update orders set accepted_at = now() - interval '30 days' where id = $1`, [OS2]);
await su(`select private.run_maintenance()`);
check((await su(`select status from orders where id = $1`, [OS2]))[0].status === 'accepted', 'acceptTimeoutDays 0 turns it off');
await as(ADM, `select admin_update_settings('{"acceptTimeoutDays": 7}')`);

console.log('disputes are refunded, not left frozen');
const LD = (await one(A, `select create_listing($1::jsonb) r`, [food({ title: '咖啡豆', pricePoints: 8 })])).r.id;
const OD = (await one(B, `select request_listing($1, '', '') r`, [LD])).r;
await as(A, `select accept_order($1)`, [OD]);
await su(`delete from notifications`);
await as(B, `select open_dispute($1, '沒有出現')`, [OD]);
check((await mail(ADM)).some((x) => x.subject.includes('爭議')), 'admins mailed about a dispute');
check((await mail(A)).length === 1 && (await mail(B)).length === 0, 'other side mailed, disputer not');
const bd = await bal(B);
await as(ADM, `select admin_set_listing_status($1, 'removed')`, [LD]);
check((await su(`select status from orders where id = $1`, [OD]))[0].status === 'cancelled', 'removing the listing cancels the dispute');
check((await bal(B)) === bd + 8, 'and refunds the requester');
const P = '00000000-0000-0000-0000-0000000000f1';
await su(`insert into auth.users values ('${P}', '886955555555', null)`);
await one(P, `select complete_signup('阿派')`);
const LP = (await one(P, `select create_listing($1::jsonb) r`, [food({ title: '茶葉', pricePoints: 6 })])).r.id;
const OP = (await one(B, `select request_listing($1, '', '') r`, [LP])).r;
await as(P, `select accept_order($1)`, [OP]);
await as(B, `select open_dispute($1, '品質不符')`, [OP]);
const bp = await bal(B);
await as(P, `select delete_account()`);
check((await su(`select status from orders where id = $1`, [OP]))[0].status === 'cancelled', 'deleting the account cancels the dispute');
check((await bal(B)) === bp + 6, 'and refunds the requester');

console.log('suspended members (migration 6)');
const G1 = '00000000-0000-0000-0000-0000000001a1';
const G2 = '00000000-0000-0000-0000-0000000001a2';
const G3 = '00000000-0000-0000-0000-0000000001a3';
const G4 = '00000000-0000-0000-0000-0000000001a4';
await su(`insert into auth.users values ('${G1}', '886961111111', null), ('${G2}', '886962222222', null), ('${G3}', '886963333333', null), ('${G4}', '886964444444', null)`);
for (const [u, n] of [[G1, '小綠'], [G2, '小藍'], [G3, '小紫'], [G4, '小橘']]) await one(u, `select complete_signup($1) r`, [n]);
const mk = async (u, extra) => (await one(u, `select create_listing($1::jsonb) r`, [food(extra)])).r.id;
const req = async (u, l) => (await one(u, `select request_listing($1, '', '') r`, [l])).r;
const ostat = async (o) => (await su(`select status, cancel_reason from orders where id = $1`, [o]))[0];
const lstat = async (l) => (await su(`select status from listings where id = $1`, [l]))[0].status;
const freeOf = (title, quantity = 1) => ({ title, mode: 'free', pricePoints: 0, quantity });
const LG1 = await mk(G1, freeOf('小綠的麵包', 5));
const LG1b = await mk(G1, freeOf('小綠的餅乾', 5));
const OG1 = await req(G2, LG1);
await as(ADM, `select admin_set_user_status($1, 'suspended', '測試停權')`, [G1]);
const sg1 = await ostat(OG1);
check(sg1.status === 'cancelled' && sg1.cancel_reason.includes('無法使用'), 'suspending cancels unanswered requests');
check((await as(G3, `select id from listings where id = $1`, [LG1b])).length === 0, "a suspended member's listings are hidden");
check((await as(null, `select id from listings where owner_id = $1`, [G1])).length === 0, 'from visitors too');
check((await as(ADM, `select id from listings where id = $1`, [LG1b])).length === 1, 'admin still sees them');
check((await err(G3, `select request_listing($1, '', '')`, [LG1b]))?.includes('無法索取'), 'and they cannot be requested');
await as(ADM, `select admin_set_user_status($1, 'active')`, [G1]);
check((await as(G3, `select id from listings where id = $1`, [LG1b])).length === 1, 'visible again after reactivation');

console.log('accepting and blocking (migration 6)');
const LG2 = await mk(G1, { title: '小綠的蛋糕', pricePoints: 10 });
const OG2 = await req(G2, LG2);
await su(`update listings set status = 'pending_review' where id = $1`, [LG2]);
check((await err(G1, `select accept_order($1)`, [OG2]))?.includes('暫停中'), 'cannot accept while the listing is hidden');
await su(`update listings set status = 'active' where id = $1`, [LG2]);
const LG3 = await mk(G1, freeOf('小綠的果汁', 3));
const OG3 = await req(G2, LG3);
await as(G1, `select accept_order($1)`, [OG3]);
const LG4 = await mk(G1, { title: '小綠的茶包', pricePoints: 5 });
const OG4 = await req(G2, LG4);
await as(G1, `select accept_order($1)`, [OG4]);
await as(G2, `select mark_done($1)`, [OG4]);
const g2before = await bal(G2);
check((await one(G2, `select toggle_block($1) r`, [G1])).r === true, 'G2 blocks G1');
check((await ostat(OG2)).status === 'cancelled', 'blocking cancels an open request');
check((await ostat(OG3)).status === 'cancelled', 'and an accepted deal nobody confirmed');
check((await ostat(OG4)).status === 'accepted', 'a deal one side confirmed carries on');
check((await bal(G2)) === g2before + 10, 'held points come back');
check((await ostat(OG2)).cancel_reason.includes('其中一方'), 'with a neutral reason');
const g1mail = await mail(G1);
check(g1mail.some((m) => m.body.includes('其中一方')) && !g1mail.some((m) => m.body.includes('封鎖')), 'the blocked member is not told about the block');
check((await su(`select remaining from listings where id = $1`, [LG3]))[0].remaining === 3, 'the cancelled accepted deal restocks');
await as(G2, `select toggle_block($1)`, [G1]);
await as(G1, `select mark_done($1)`, [OG4]);
check((await ostat(OG4)).status === 'completed', 'the confirmed deal completes after unblocking');
const OG2b = await req(G3, LG2);
await su(`insert into blocks (blocker_id, blocked_id) values ($1, $2)`, [G3, G1]);
check((await err(G1, `select accept_order($1)`, [OG2b]))?.includes('封鎖'), 'cannot accept across a block');
await su(`delete from blocks where blocker_id = $1`, [G3]);
await as(G1, `select decline_order($1, '')`, [OG2b]);

console.log('photos (migration 6)');
const prefix = (await su(`select photo_url_prefix p from settings`))[0].p;
check(prefix.endsWith('/listing-photos/'), 'photo prefix is set');
check((await err(G1, `select create_listing($1::jsonb)`, [food({ photos: ['https://evil.example.com/x.jpg'] })]))?.includes('照片'), 'rejects photos from other sites');
check((await err(G1, `select create_listing($1::jsonb)`, [food({ photos: [`${prefix}${G2}/x.jpg`] })]))?.includes('照片'), "rejects another member's photo folder");
check((await err(G1, `select create_listing($1::jsonb)`, [food({ photos: [`${prefix}${G1}/../${G2}/x.jpg`] })]))?.includes('照片'), 'rejects .. in photo paths');
check(!!(await mk(G1, { title: '有照片的吐司', photos: [`${prefix}${G1}/a.jpg`] })), 'accepts photos uploaded to Myrs');

console.log('admin approval (migration 6)');
const LG5 = await mk(G1, freeOf('自製果醬'));
check((await lstat(LG5)) === 'pending_review', 'flagged listing waits for review');
await as(ADM, `select admin_set_listing_status($1, 'active')`, [LG5]);
const l5 = (await su(`select status, flagged_words from listings where id = $1`, [LG5]))[0];
check(l5.status === 'active' && l5.flagged_words.length === 0, 'approval clears the flagged words');
for (const u of [G2, G3, G4]) await as(u, `select report('listing', $1, '疑似違規')`, [LG5]);
check((await lstat(LG5)) === 'pending_review', 'reports hide it again');
const rp5 = (await as(ADM, `select id from reports where target_id = $1 and status = 'open' limit 1`, [LG5]))[0].id;
await as(ADM, `select admin_handle_report($1, 'dismiss')`, [rp5]);
check((await lstat(LG5)) === 'active', 'dismissing the reports restores an approved listing');
for (const u of [G2, G3, G4]) await as(u, `select report('listing', $1, '還是違規')`, [LG5]);
await as(ADM, `select admin_set_listing_status($1, 'active')`, [LG5]);
check((await su(`select count(*)::int n from reports where target_id = $1 and status = 'open'`, [LG5]))[0].n === 0, 'approving settles the open reports');
await as(G1, `select close_listing($1)`, [LG5]);
check((await err(ADM, `select admin_set_listing_status($1, 'active')`, [LG5]))?.includes('待審核'), 'a closed listing cannot be re-approved');
await as(ADM, `select admin_set_listing_status($1, 'removed')`, [LG5]);
check((await err(ADM, `select admin_set_listing_status($1, 'removed')`, [LG5]))?.includes('已經下架'), 'cannot remove twice');
check((await err(ADM, `select admin_set_listing_status($1, 'active')`, [LG5]))?.includes('待審核'), 'a removed listing cannot be re-approved');

console.log('exact spot after cancelling (migration 6)');
const LG6 = await mk(G1, { title: '小綠的咖啡', pricePoints: 5 });
const OG6 = await req(G3, LG6);
await as(G1, `select accept_order($1)`, [OG6]);
check((await as(G3, `select * from listing_secrets where listing_id = $1`, [LG6])).length === 1, 'accepted requester sees the exact spot');
await as(G3, `select cancel_my_order($1, '臨時有事')`, [OG6]);
check((await as(G3, `select * from listing_secrets where listing_id = $1`, [LG6])).length === 0, 'but not after cancelling');

console.log('fees (migration 6)');
const fees6 = (await su(`select private.calc_fee(0) a, private.calc_fee(1) b, private.calc_fee(2) c, private.calc_fee(20) d`))[0];
const st6 = (await su(`select fee_rate, min_fee, free_daily_limit from settings`))[0];
check(fees6.a === 0 && fees6.b === 0 && fees6.c === 1 && fees6.d === Math.min(19, Math.max(st6.min_fee, Math.ceil(20 * st6.fee_rate))), `the fee never takes the whole price (${Object.values(fees6)})`);
const LG7 = await mk(G1, { title: '一點的糖果', pricePoints: 1 });
const OG7 = await req(G3, LG7);
await as(G1, `select accept_order($1)`, [OG7]);
const g1b = await bal(G1);
await as(G3, `select mark_done($1)`, [OG7]);
await as(G1, `select mark_done($1)`, [OG7]);
check((await bal(G1)) === g1b + 1, 'a 1-point deal pays the provider 1 point');

console.log('free daily limit (migration 6)');
const FG = [];
const lim = st6.free_daily_limit;
for (let i = 0; i < lim + 3; i++) FG.push(await mk(G1, freeOf(`免費小點心${i}`, 3)));
const fg = [];
for (let i = 0; i < lim; i++) fg.push(await req(G3, FG[i]));
check((await err(G3, `select request_listing($1, '', '')`, [FG[lim]]))?.includes('每天最多'), `limit reached (${lim})`);
await as(G1, `select decline_order($1, '')`, [fg[0]]);
await as(G1, `select decline_order($1, '')`, [fg[1]]);
const f4 = await req(G3, FG[lim]);
check(!!f4, 'declined requests do not count');
await as(G3, `select cancel_my_order($1, '')`, [f4]);
await req(G3, FG[lim + 1]);
check((await err(G3, `select request_listing($1, '', '')`, [FG[lim + 2]]))?.includes('每天最多'), 'own withdrawals still count');

console.log('settings (migration 6)');
const setp = (j) => err(ADM, `select admin_update_settings($1::jsonb)`, [j]);
check((await setp('{"requestTimeoutHours":0}'))?.includes('至少要是 1'), 'request timeout must be at least 1');
check((await setp('{"reviewWindowDays":0.5}'))?.includes('至少要是 1'), 'review window must be at least 1');
check((await setp('{"reportHideThreshold":0}'))?.includes('至少要是 1'), 'report threshold must be at least 1');
check((await setp('{"acceptTimeoutDays":0.5}'))?.includes('0（關閉）'), 'accept timeout is 0 or at least 1');
check((await setp('{"acceptTimeoutDays":0}')) === null, '0 still turns the accept timeout off');
await setp('{"acceptTimeoutDays":7}');

console.log('completed deals (migration 6)');
const cd = async (u) => (await one(null, `select completed_deals n from profiles where id = $1`, [u])).n;
check((await cd(G1)) === 2 && (await cd(G2)) === 1 && (await cd(G3)) === 1, 'both sides of a completed deal are counted');
const aDeals = (await su(`select count(*)::int n from orders where status = 'completed' and (requester_id = $1 or provider_id = $1)`, [A]))[0].n;
check((await cd(A)) === aDeals, `matches the order history (${aDeals})`);

console.log('favorites (migration 6)');
check((await one(G3, `select toggle_favorite($1) r`, [LG2])).r === true, 'add a favorite');
check((await as(G3, `select * from favorites`)).length === 1, 'member sees own favorites');
check((await as(G2, `select * from favorites`)).length === 0, 'others cannot see them');
check((await one(G3, `select toggle_favorite($1) r`, [LG2])).r === false, 'toggling again removes it');
check((await err(G1, `select toggle_favorite($1)`, [LG2]))?.includes('自己'), 'cannot favorite own listing');
check((await err(G3, `select toggle_favorite($1)`, [LG5]))?.includes('無法收藏'), 'cannot favorite a removed listing');
check((await err(G3, `insert into favorites (user_id, listing_id) values ('${G3}', '${LG2}')`))?.includes('permission denied'), 'no direct writes to favorites');

console.log('keyword alerts (migration 6)');
const near = [25.03, 121.53];
const ss = async (u, kw, cat = null, r = 3, p = near) =>
  (await one(u, `select save_search($1, $2, $3, $4, $5) r`, [kw, cat, r, p[0], p[1]])).r;
const s1 = await ss(G2, '鳳梨');
check((await ss(G2, '鳳梨', null, 5)) === s1, 'saving the same keyword again updates it');
await ss(G2, '鳳梨', 'food');
for (const k of ['芒果', '香蕉', '西瓜']) await ss(G2, k);
check((await err(G2, `select save_search('葡萄', null, 3, 25.03, 121.53)`))?.includes('最多 5'), 'at most 5 keyword alerts');
check((await as(G3, `select * from saved_searches`)).length === 0, "others cannot see a member's keywords");
check((await err(G3, `select delete_saved_search($1)`, [s1]))?.includes('找不到'), "cannot delete another member's keyword");
check((await err(G2, `select save_search(' ', null, 3, 25.03, 121.53)`))?.includes('關鍵字'), 'a keyword is required');
check((await err(G2, `select save_search('葡萄', null, 50, 25.03, 121.53)`))?.includes('範圍'), 'the radius is limited');
await ss(G1, '鳳梨');
await ss(G3, '鳳梨', null, 3, [24.15, 120.67]);
await ss(G4, '鳳梨');
await as(G4, `select toggle_block($1)`, [G1]);
const alerts = async (u) => (await mail(u)).filter((m) => m.subject.startsWith('附近有新刊登'));
const LA = await mk(G1, freeOf('新鮮鳳梨'));
const a2 = await alerts(G2);
check(a2.length === 1 && a2[0].link === `/listings/view?id=${LA}` && a2[0].body.includes('「鳳梨」'), 'a matching member gets one alert mail');
check((await alerts(G1)).length === 0, 'the owner gets none');
check((await alerts(G3)).length === 0, 'too far away, none');
check((await alerts(G4)).length === 0, 'blocked members get none');
await as(G4, `select toggle_block($1)`, [G1]);
const LA2 = await mk(G1, freeOf('鳳梨啤酒'));
check((await alerts(G2)).length === 1, 'no alert while waiting for review');
await as(ADM, `select admin_set_listing_status($1, 'active')`, [LA2]);
check((await alerts(G2)).length === 2, 'alert once approved');
const oa = await req(G2, LA);
await as(G1, `select accept_order($1)`, [oa]);
await as(G2, `select cancel_my_order($1, '不需要了')`, [oa]);
check((await lstat(LA)) === 'active' && (await alerts(G2)).length === 2, 'no second alert when the listing comes back');
const g4n = (await alerts(G4)).length;
await su(`insert into notifications (user_id, subject, body) select $1, '附近有新刊登：舊的', '' from generate_series(1, 10)`, [G4]);
await mk(G1, freeOf('鳳梨乾'));
check((await alerts(G4)).length === g4n + 10 && (await alerts(G2)).length === 3, 'at most 10 alert mails a day');
await as(G2, `select delete_saved_search($1)`, [s1]);
check((await as(G2, `select * from saved_searches`)).length === 4, 'member deletes a keyword alert');

console.log('moving the meeting spot (migration 6)');
const LM = await mk(G1, freeOf('可以改地點的書'));
await as(G1, `select update_listing_location($1, 25.05, 121.55, '捷運中山站附近')`, [LM]);
const lmSec = (await su(`select lat, lng from listing_secrets where listing_id = $1`, [LM]))[0];
const lmPub = (await su(`select lat, lng, area_label from listings where id = $1`, [LM]))[0];
const lmMoved = Math.hypot((lmPub.lat - 25.05) * 111320, (lmPub.lng - 121.55) * 111320 * Math.cos((25.05 * Math.PI) / 180));
check(lmSec.lat === 25.05 && lmSec.lng === 121.55 && lmPub.area_label === '捷運中山站附近', 'the owner moves the meeting spot');
check(lmMoved >= 59 && lmMoved <= 181, `the public point is fuzzed again (${lmMoved.toFixed(0)} m)`);
check((await err(G2, `select update_listing_location($1, 25.05, 121.55, 'x')`, [LM]))?.includes('找不到'), 'only the owner can move it');
check((await err(G1, `select update_listing_location($1, 25.05, 121.55, ' ')`, [LM]))?.includes('地點名稱'), 'a place name is required');
const om = await req(G2, LM);
await as(G1, `select accept_order($1)`, [om]);
check((await err(G1, `select update_listing_location($1, 25.06, 121.56, '別處')`, [LM]))?.includes('另約地點'), 'not after a deal was accepted');

console.log('admin levels (migration 7)');
const M1 = '00000000-0000-0000-0000-0000000002b1';
const M2 = '00000000-0000-0000-0000-0000000002b2';
const M3 = '00000000-0000-0000-0000-0000000002b3';
await su(`insert into auth.users values ('${M1}', '886971111111', null), ('${M2}', '886972222222', null), ('${M3}', '886973333333', null)`);
for (const [u, n] of [[M1, '審審'], [M2, '管管'], [M3, '小黑']]) await one(u, `select complete_signup($1) r`, [n]);
const lvl = async (u) => (await su(`select role, admin_level, status from profiles where id = $1`, [u]))[0];
check((await lvl(ADM)).admin_level === 'owner', 'existing admins become owners');
check((await err(M2, `select admin_set_role($1, 'admin')`, [M2]))?.includes('擁有者'), 'members cannot appoint staff');
await su(`delete from notifications`);
await as(ADM, `select admin_set_role($1, 'moderator')`, [M1]);
await as(ADM, `select admin_set_role($1, 'admin')`, [M2]);
check((await lvl(M1)).role === 'admin' && (await lvl(M1)).admin_level === 'moderator', 'the owner appoints a moderator');
check((await mail(M2)).some((x) => x.subject.includes('管理權限') && x.body.includes('管理員')), 'new staff are told by e-mail');
check((await err(M2, `select admin_set_role($1, 'admin')`, [M1]))?.includes('擁有者'), 'admins cannot appoint staff');
check((await err(ADM, `select admin_set_role($1, 'admin')`, [M2]))?.includes('已經是'), 'no-op change refused');
const LDM = await mk(G3, freeOf('舊雨傘'));
const ODM = await req(G2, LDM);
await as(G3, `select accept_order($1)`, [ODM]);
await su(`delete from notifications`);
await as(G2, `select open_dispute($1, '沒有出現')`, [ODM]);
check((await mail(M2)).some((x) => x.subject.includes('爭議')), 'admins are mailed about disputes');
check((await mail(M1)).length === 0, 'moderators are not');

const LQ = await mk(M3, { title: '自製果醬' });
check((await lstat(LQ)) === 'pending_review', 'a flagged listing waits for review');
check((await as(M1, `select id from listings where id = $1`, [LQ])).length === 1, 'moderators see pending listings');
await as(M1, `select admin_set_listing_status($1, 'active')`, [LQ]);
check((await lstat(LQ)) === 'active', 'moderators approve listings');
check((await as(M1, `select * from ledger where user_id <> $1`, [M1])).length === 0, "moderators cannot read others' points");
check((await as(M1, `select * from listing_secrets where listing_id = $1`, [LQ])).length === 0, 'or exact meeting spots');
check((await as(M1, `select * from messages`)).length === 0, 'or chats');
check((await as(M1, `select * from admin_log`)).length === 0, 'or the admin log');
check((await as(M2, `select * from listing_secrets where listing_id = $1`, [LQ])).length === 1, 'admins still see exact spots');
check((await err(M1, `select admin_set_user_status($1, 'suspended', 'x')`, [M3]))?.includes('管理員'), 'moderators cannot suspend');
check((await err(M1, `select admin_resolve_dispute($1, 'refund', '')`, [O5]))?.includes('管理員'), 'or rule on disputes');
check((await err(M1, `select admin_set_merchant($1, true)`, [M3]))?.includes('管理員'), 'or set merchants');
check((await err(M2, `select admin_adjust_points($1, 5, 'x')`, [M3]))?.includes('擁有者'), 'only owners adjust points');
check((await err(M2, `select admin_update_settings('{"minFee": 1}')`))?.includes('擁有者'), 'and change settings');

for (const u of [G2, G3]) await as(u, `select report('listing', $1, '疑似轉賣')`, [LQ]);
const rpm = (await as(M1, `select id from reports where target_id = $1 and status = 'open' limit 1`, [LQ]))[0]?.id;
check(!!rpm, 'moderators see reports');
const LSELF = await mk(M1, { title: '自製果醬禮盒' });
check((await err(M1, `select admin_set_listing_status($1, 'active')`, [LSELF]))?.includes('自己的刊登'), 'staff cannot approve their own listing');
await as(G2, `select report('listing', $1, '疑似轉賣')`, [LSELF]);
const rself = (await as(M1, `select id from reports where target_id = $1 and status = 'open' limit 1`, [LSELF]))[0]?.id;
check((await err(M1, `select admin_handle_report($1, 'dismiss')`, [rself]))?.includes('針對自己'), 'or handle reports against themselves');
await as(ADM, `select admin_set_listing_status($1, 'active')`, [LSELF]);
check((await lstat(LSELF)) === 'active', 'another staff member can');
check((await err(M1, `select admin_handle_report($1, 'suspend_user')`, [rpm]))?.includes('管理員'), 'moderators cannot suspend through a report');
await su(`delete from notifications`);
await as(M1, `select admin_handle_report($1, 'remove_listing')`, [rpm]);
check((await lstat(LQ)) === 'removed', 'moderators remove a reported listing');
const mrm = await mail(M3);
check(mrm.length === 1 && mrm[0].subject.includes('已被下架') && !mrm[0].body.includes('轉賣'), "the owner is told, without the reporter's words");

const LR = await mk(M3, freeOf('普通的書'));
const orr = await req(G2, LR);
await su(`delete from notifications`);
check((await err(B, `select admin_set_listing_status($1, 'removed', 'x')`, [LR]))?.includes('審核員'), 'members cannot remove listings');
await as(M1, `select admin_set_listing_status($1, 'removed', '販售違禁品')`, [LR]);
const orrS = await ostat(orr);
check(orrS.status === 'cancelled' && orrS.cancel_reason.includes('販售違禁品'), 'removing any listing cancels its requests, with the reason');
check((await mail(M3)).some((x) => x.subject.includes('已被下架') && x.body.includes('販售違禁品')), 'and tells the owner why');

await su(`delete from notifications`);
check((await err(M2, `select admin_set_user_status($1, 'suspended', ' ')`, [M3]))?.includes('原因'), 'a suspension needs a reason');
check((await err(M2, `select admin_set_user_status($1, 'suspended', '洗點', 0)`, [M3]))?.includes('天數'), 'days are 1 to 365');
check((await err(M2, `select admin_set_user_status($1, 'suspended', 'x')`, [M1]))?.includes('管理團隊'), 'staff cannot be suspended');
await as(M2, `select admin_set_user_status($1, 'suspended', '多次爽約', 3)`, [M3]);
const sm = await mail(M3);
check(sm.length === 1 && sm[0].body.includes('多次爽約') && sm[0].body.includes('自動恢復'), 'the member is told why and until when');
const smErr = await err(M3, `select update_profile('x', '')`);
check(!!smErr?.includes('多次爽約') && smErr.includes('自動恢復'), 'and sees it when using the site');
check((await as(M3, `select reason from suspensions`)).length === 1, 'the member reads their own suspension');
check((await as(G2, `select * from suspensions`)).length === 0, 'other members cannot');
check((await as(M1, `select * from suspensions`)).length === 0, 'moderators cannot either');
check((await as(M2, `select * from suspensions where user_id = $1`, [M3])).length === 1, 'admins can');
await su(`select private.run_maintenance()`);
check((await lvl(M3)).status === 'suspended', 'still suspended before the period ends');
await su(`update suspensions set until = now() - interval '1 minute' where user_id = $1`, [M3]);
await su(`select private.run_maintenance()`);
check((await lvl(M3)).status === 'active', 'restored when the period ends');
check((await su(`select (lifted_at is not null and lifted_by is null) ok from suspensions where user_id = $1`, [M3]))[0].ok, 'recorded as lifted by the system');
check((await mail(M3)).some((x) => x.subject.includes('已恢復')), 'and told by e-mail');
await as(M2, `select admin_set_user_status($1, 'suspended', '詐騙')`, [M3]);
check(!!(await err(M3, `select update_profile('x', '')`))?.includes('客服'), 'no end date: contact support');
await su(`select private.run_maintenance()`);
check((await lvl(M3)).status === 'suspended', 'no end date is never lifted by itself');
await as(M2, `select admin_set_user_status($1, 'active')`, [M3]);
check((await lvl(M3)).status === 'active' && (await su(`select count(*)::int n from suspensions where user_id = $1 and lifted_by = $2`, [M3, M2]))[0].n === 1, 'admins restore it');
check((await err(M2, `select admin_set_user_status($1, 'active')`, [M3]))?.includes('沒有被停權'), 'cannot restore an active member');

check((await err(ADM, `select admin_set_role($1, 'member')`, [ADM]))?.includes('至少要留一位擁有者'), 'the last owner cannot step down');
check((await err(ADM, `select delete_account()`))?.includes('至少要留一位擁有者'), 'or delete the account');
await as(ADM, `select admin_set_role($1, 'owner')`, [M2]);
check((await err(ADM, `select admin_set_role($1, 'member')`, [M2]))?.includes('其他擁有者'), 'owners cannot demote other owners');
await as(M2, `select admin_set_role($1, 'admin')`, [M2]);
check((await lvl(M2)).admin_level === 'admin', 'an owner can step down while another owner remains');
await as(ADM, `select admin_set_role($1, 'member')`, [M1]);
check((await lvl(M1)).role === 'member' && (await lvl(M1)).admin_level === null, 'the owner removes a moderator');
check((await as(M1, `select * from reports where reporter_id <> $1`, [M1])).length === 0, 'who loses the staff reads');
check((await err(ADM, `select admin_set_role($1, 'admin')`, [D]))?.includes('停權'), 'suspended members cannot join the staff');
check((await su(`select count(*)::int n from admin_log where action like '%改為%'`))[0].n === 5, 'every role change is logged');

console.log('admin tools (migration 8)');
const lastLog = async (prefix) =>
  (await su(`select action from admin_log where action like $1 order by created_at desc limit 1`, [`${prefix}%`]))[0]?.action ?? '';
const setWords = (u, words) =>
  as(u, `select admin_set_banned_words(array(select jsonb_array_elements_text($1::jsonb)))`, [JSON.stringify(words)]);
const wordsErr = (u, words) =>
  err(u, `select admin_set_banned_words(array(select jsonb_array_elements_text($1::jsonb)))`, [JSON.stringify(words)]);
const bw = async () => (await su(`select banned_words from settings`))[0].banned_words;
const w0 = await bw();
check(w0.includes('酒') && w0.includes('自製'), 'the old list carries over');
check((await wordsErr(M2, ['酒']))?.includes('擁有者'), 'only owners edit banned words');
await setWords(ADM, [...w0.filter((w) => w !== '自製'), ' 彩券 ', '彩券', '']);
const w1 = await bw();
check(w1.includes('彩券') && !w1.includes('自製') && w1.filter((w) => w === '彩券').length === 1 && !w1.includes(''), 'owners edit the list (trimmed, no repeats or blanks)');
check((await lastLog('更新禁售詞')).includes('新增「彩券」') && (await lastLog('更新禁售詞')).includes('移除「自製」'), 'the log lists added and removed words');
check((await lstat(await mk(G2, { title: '刮刮樂彩券' }))) === 'pending_review', 'a new word sends listings to review');
check((await lstat(await mk(G2, { title: '自製餅乾' }))) === 'active', 'a removed word no longer does');
check((await wordsErr(ADM, w1))?.includes('沒有變更'), 'an unchanged list is refused');
check((await wordsErr(ADM, [...w1, '一二三四五六七八九十一']))?.includes('太長'), 'words are at most 10 characters');
await setWords(ADM, w0);

check((await err(M2, `select admin_set_announcement('x')`))?.includes('擁有者'), 'only owners post announcements');
await as(ADM, `select admin_set_announcement('  週末系統維護  ', now() + interval '2 days')`);
const an = await one(G2, `select announcement, announcement_until, announcement_at from settings`);
check(an.announcement === '週末系統維護' && !!an.announcement_until && !!an.announcement_at, 'everyone reads the announcement');
check((await lastLog('發布全站公告')).includes('週末系統維護'), 'and it is logged');
check((await err(ADM, `select admin_set_announcement('x', now() - interval '1 hour')`))?.includes('之後'), 'the end time must be in the future');
check((await err(ADM, `select admin_set_announcement($1)`, ['長'.repeat(201)]))?.includes('200'), 'at most 200 characters');
await as(ADM, `select admin_set_announcement('')`);
check((await su(`select announcement, announcement_at from settings`))[0].announcement === '', 'an empty text takes it down');
check((await err(ADM, `select admin_set_announcement('')`))?.includes('沒有公告'), 'nothing to take down');

await as(ADM, `select admin_set_role($1, 'moderator')`, [M1]);
await su(`delete from notifications`);
await su(`select private.notify($1, '還在排隊', '信件內文', '/')`, [G2]);
await su(`insert into notifications (user_id, subject, body, attempts, last_error) values ($1, '寄不出去', '信件內文', 5, 'Error: 550 someone@example.com mailbox unavailable')`, [G3]);
await su(`insert into notifications (user_id, subject, body, sent_at, last_error) values ($1, '沒有信箱', '信件內文', now(), 'no e-mail address')`, [G3]);
await su(`insert into notifications (user_id, subject, body, sent_at) values ($1, '寄出了', '信件內文', now())`, [G3]);
const ms = (await one(M2, `select admin_mail_status() r`)).r;
check(ms.pending === 1 && ms.failed === 1 && ms.sent24h === 1 && ms.noAddress === 1, 'admins see mail counts');
check(ms.items.length === 3 && !ms.items.some((x) => x.subject === '寄出了'), 'problem mail only by default');
const g3name = (await su(`select name from profiles where id = $1`, [G3]))[0].name;
const fm = ms.items.find((x) => x.state === 'failed');
check(!!fm && fm.name === g3name && !fm.error.includes('@') && fm.error.includes('（信箱）'), 'with names, and addresses masked');
check(!JSON.stringify(ms).includes('信件內文'), 'without message bodies');
check((await one(M2, `select admin_mail_status('all') r`)).r.items.length === 4, 'or all mail');
check((await err(M1, `select admin_mail_status()`))?.includes('管理員'), 'moderators cannot see mail status');
check((await err(M1, `select admin_retry_mail()`))?.includes('管理員'), 'or resend mail');
check((await one(M2, `select admin_retry_mail() r`)).r === 1, 'failed mail is queued again');
check((await su(`select attempts, last_error from notifications where subject = '寄不出去'`))[0].attempts === 0, 'with its attempts reset');
check((await err(M2, `select admin_retry_mail()`))?.includes('沒有需要重寄'), 'nothing left to resend');
check((await lastLog('重新寄出')).includes('1 封'), 'resending is logged');

const s0 = (await su(`select fee_rate, min_fee from settings`))[0];
await as(ADM, `select admin_update_settings($1::jsonb)`, [JSON.stringify({ feeRate: 0.08, minFee: s0.min_fee + 1, signupBonus: 50 })]);
const sl = await lastLog('更新平台參數');
check(
  sl.includes(`手續費比例 ${+(s0.fee_rate * 100).toFixed(4)}% → 8%`) && sl.includes(`最低手續費 ${s0.min_fee} 點 → ${s0.min_fee + 1} 點`) && !sl.includes('新手點數'),
  'the settings log says what changed, and only that',
);
check((await err(ADM, `select admin_update_settings('{"feeRate": 0.08}')`))?.includes('沒有變更'), 'an unchanged save is refused');
await as(ADM, `select admin_update_settings($1::jsonb)`, [JSON.stringify({ feeRate: s0.fee_rate, minFee: s0.min_fee })]);

const sum = (await su(`select sum(amount)::int s from ledger where type in ('signup_bonus','reward','adjust')`))[0].s;
const fees = (await su(`select -sum(amount)::int s from ledger where type = 'fee'`))[0].s;
const circ = (await su(`select sum(amount)::int s from ledger`))[0].s;
const held = (await su(`select coalesce(sum(points),0)::int s from orders where mode='points' and status in ('requested','accepted','disputed')`))[0].s;
check(sum - fees === circ + held, `points conserved: issued ${sum} − fees ${fees} = available ${circ} + held ${held}`);

console.log(failures ? `\n${failures} FAILED` : '\nall checks passed');
process.exit(failures ? 1 : 0);
