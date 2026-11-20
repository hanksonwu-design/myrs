'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Shield, Smartphone, Store } from 'lucide-react';
import { actions, currentUser, useDB } from '@/lib/store';
import { DEMO_OTP, PHONE_RE } from '@/lib/rules';
import { maskPhone } from '@/lib/format';
import { Avatar } from '@/components/ui';
import { useToast } from '@/components/Providers';
import { RemoteLogin } from '@/components/RemoteLogin';
import { IS_REMOTE } from '@/lib/backend';
import { pendingInvite } from '@/lib/invite';
import { InviteCodeField, applyInviteAfterSignup } from '@/components/InviteCard';

function LoginInner() {
  const d = useDB()!;
  const router = useRouter();
  const params = useSearchParams();
  const toast = useToast();
  const next = params.get('next') || '/';
  const safeNext = next.startsWith('/') && !next.startsWith('//') ? next : '/';
  const [step, setStep] = useState<'phone' | 'code' | 'name'>('phone');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [invite, setInvite] = useState('');
  const [error, setError] = useState('');
  const me = currentUser(d);
  useEffect(() => setInvite(pendingInvite()), []);
  if (IS_REMOTE) return <RemoteLogin d={d} next={safeNext} />;

  const done = (msg: string) => {
    toast(msg);
    router.replace(safeNext);
  };

  const sendCode = (e: React.FormEvent) => {
    e.preventDefault();
    const p = phone.replace(/\D/g, '');
    if (!PHONE_RE.test(p)) {
      setError('請輸入 09 開頭的 10 碼手機號碼');
      return;
    }
    setPhone(p);
    setError('');
    setStep('code');
  };

  const verify = async (e: React.FormEvent) => {
    e.preventDefault();
    if (code !== DEMO_OTP) {
      setError('驗證碼不正確');
      return;
    }
    setError('');
    const r = await actions.loginWithPhone(phone);
    if (r.ok) done(`歡迎回來，${r.value.name}`);
    else if (r.error === 'NOT_FOUND') setStep('name');
    else setError(r.error);
  };

  const register = async (e: React.FormEvent) => {
    e.preventDefault();
    const r = await actions.register(phone, name);
    if (!r.ok) return setError(r.error);
    const inv = await applyInviteAfterSignup(invite);
    done(`註冊完成，送你 ${d.settings.signupBonus} 點新手點數！${inv.note}`);
    if (inv.error) toast(inv.error, 'info');
  };

  const demoUsers = d.users.filter((u) => u.status === 'active');

  return (
    <div className="mx-auto grid max-w-4xl gap-6 md:grid-cols-2">
      <section className="card p-6">
        <div className="mb-5 flex items-center gap-3">
          <span className="flex size-11 items-center justify-center rounded-2xl bg-brand-soft text-brand">
            <Smartphone className="size-5" />
          </span>
          <div>
            <h1 className="text-xl font-bold">手機號碼登入／註冊</h1>
            <p className="text-sm text-slate-500">一個手機號碼一個帳號</p>
          </div>
        </div>

        {me && (
          <p className="mb-4 rounded-xl bg-slate-50 p-3 text-sm text-slate-600">
            目前登入：<b>{me.name}</b>。登入其他帳號會自動切換。
          </p>
        )}

        {step === 'phone' && (
          <form onSubmit={sendCode} className="space-y-4">
            <div>
              <label className="label" htmlFor="phone">
                手機號碼
              </label>
              <input
                id="phone"
                className="input text-base"
                inputMode="numeric"
                autoComplete="tel"
                placeholder="0912345678"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
              />
            </div>
            {error && <p className="text-sm text-m-rose">{error}</p>}
            <button className="btn btn-primary w-full">取得簡訊驗證碼</button>
          </form>
        )}

        {step === 'code' && (
          <form onSubmit={verify} className="space-y-4">
            <p className="text-sm text-slate-600">
              驗證碼已傳到 <b>{maskPhone(phone)}</b>
            </p>
            <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-800">
              示範版不會真的寄簡訊，驗證碼一律是 <b className="tracking-widest">{DEMO_OTP}</b>
            </p>
            <div>
              <label className="label" htmlFor="code">
                6 位數驗證碼
              </label>
              <input
                id="code"
                className="input text-center text-lg tracking-[0.5em]"
                inputMode="numeric"
                maxLength={6}
                autoFocus
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
              />
            </div>
            {error && <p className="text-sm text-m-rose">{error}</p>}
            <button className="btn btn-primary w-full">驗證</button>
            <button type="button" className="btn btn-ghost w-full" onClick={() => setStep('phone')}>
              換一個號碼
            </button>
          </form>
        )}

        {step === 'name' && (
          <form onSubmit={register} className="space-y-4">
            <p className="text-sm text-slate-600">第一次使用 Myrs，取個暱稱吧。完成後送你 {d.settings.signupBonus} 點。</p>
            <div>
              <label className="label" htmlFor="name">
                暱稱
              </label>
              <input
                id="name"
                className="input"
                maxLength={20}
                autoFocus
                placeholder="例如：大安小陳"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <InviteCodeField value={invite} onChange={setInvite} />
            {error && <p className="text-sm text-m-rose">{error}</p>}
            <button className="btn btn-primary w-full">完成註冊</button>
          </form>
        )}

        <p className="mt-5 text-xs leading-relaxed text-slate-400">
          註冊即表示同意使用條款與隱私權政策。點數只能在 Myrs 內使用，不能兌換現金或轉帳給他人。
        </p>
      </section>

      <section className="card p-6">
        <h2 className="font-bold">示範帳號（一鍵登入）</h2>
        <p className="mb-4 mt-1 text-sm text-slate-500">用不同帳號登入，就能體驗提供者和索取者兩邊的流程。</p>
        <ul className="space-y-2">
          {demoUsers.map((u) => (
            <li key={u.id}>
              <button
                className="flex w-full items-center gap-3 rounded-xl border border-slate-200 p-3 text-left transition hover:border-brand hover:bg-brand-soft/40"
                onClick={async () => {
                  const r = await actions.loginAs(u.id);
                  if (r.ok) done(`已用「${u.name}」登入`);
                  else toast(r.error, 'error');
                }}
              >
                <Avatar user={u} size={36} />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1 font-semibold">
                    {u.name}
                    {u.merchant && <Store className="size-3.5 text-brand" />}
                    {u.role === 'admin' && <Shield className="size-3.5 text-slate-600" />}
                  </span>
                  <span className="block truncate text-xs text-slate-500">{u.bio || maskPhone(u.phone)}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginInner />
    </Suspense>
  );
}
