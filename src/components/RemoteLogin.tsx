'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Mail, ShieldAlert, Smartphone } from 'lucide-react';
import { actions, currentUser } from '@/lib/store';
import { remoteAuth, type LoginMethod } from '@/lib/remote';
import { LOGIN_METHODS } from '@/lib/backend';
import { PHONE_RE } from '@/lib/rules';
import { maskPhone } from '@/lib/format';
import { activeSuspension, suspensionNote } from '@/lib/staff';
import type { DB } from '@/lib/types';
import { useToast } from './Providers';
import { pendingInvite } from '@/lib/invite';
import { InviteCodeField, applyInviteAfterSignup } from './InviteCard';
import { ConsentNote } from './Legal';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const RESEND_SECONDS = 60;

/** Supabase Auth sign-in: one-time code by SMS or e-mail; first login creates the account. */
export function RemoteLogin({ d, next }: { d: DB; next: string }) {
  const router = useRouter();
  const toast = useToast();
  const methods: LoginMethod[] = LOGIN_METHODS.length ? LOGIN_METHODS : ['email'];
  const [method, setMethod] = useState<LoginMethod>(methods[0]);
  const [step, setStep] = useState<'id' | 'code'>('id');
  const [id, setId] = useState('');
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [invite, setInvite] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [wait, setWait] = useState(0);
  const me = currentUser(d);
  const state = d.auth?.state;

  useEffect(() => setInvite(pendingInvite()), []);

  useEffect(() => {
    if (wait <= 0) return;
    const t = setTimeout(() => setWait((w) => w - 1), 1000);
    return () => clearTimeout(t);
  }, [wait]);

  const done = (msg: string) => {
    toast(msg);
    router.replace(next);
  };

  const send = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const value = method === 'phone' ? id.replace(/\D/g, '') : id.trim().toLowerCase();
    if (method === 'phone' && !PHONE_RE.test(value)) return setError('請輸入 09 開頭的 10 碼手機號碼');
    if (method === 'email' && !EMAIL_RE.test(value)) return setError('請輸入正確的 Email');
    setBusy(true);
    const r = await remoteAuth.sendCode(method, value);
    setBusy(false);
    if (!r.ok) return setError(r.error);
    setId(value);
    setError('');
    setCode('');
    setStep('code');
    setWait(RESEND_SECONDS);
  };

  const verify = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!/^\d{6,8}$/.test(code)) return setError('請輸入信件或簡訊裡的數字驗證碼');
    setBusy(true);
    const r = await remoteAuth.verifyCode(method, id, code);
    setBusy(false);
    if (!r.ok) return setError(r.error);
    setError('');
    if (r.value?.state === 'ok') done('歡迎回來！');
  };

  const register = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const r = await remoteAuth.completeSignup(name);
    if (!r.ok) {
      setBusy(false);
      return setError(r.error);
    }
    const inv = await applyInviteAfterSignup(invite);
    setBusy(false);
    done(`${r.value.bonus ? `註冊完成，送你 ${r.value.bonus} 點新手點數！` : '註冊完成！'}${inv.note}`);
    if (inv.error) toast(inv.error, 'info');
  };

  const Icon = method === 'phone' ? Smartphone : Mail;
  const label = method === 'phone' ? '手機號碼' : 'Email';

  let body: React.ReactNode;
  if (state === 'suspended') {
    body = (
      <div className="space-y-4">
        <p className="flex items-start gap-2 rounded-xl bg-rose-50 p-3 text-sm text-m-rose">
          <ShieldAlert className="mt-0.5 size-4 shrink-0" />
          {suspensionNote(activeSuspension(d, me?.id))}
        </p>
        <button className="btn btn-outline w-full" onClick={() => actions.logout()}>
          登出
        </button>
      </div>
    );
  } else if (state === 'needs_signup') {
    body = (
      <form onSubmit={register} className="space-y-4">
        <p className="text-sm text-slate-600">
          已驗證 <b>{maskPhone(d.auth?.identity ?? '')}</b>。第一次使用 Myrs，取個暱稱吧，完成後送你 {d.settings.signupBonus} 點。
        </p>
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
        <button className="btn btn-primary w-full" disabled={busy}>
          {busy ? '建立中…' : '完成註冊'}
        </button>
        <button type="button" className="btn btn-ghost w-full" onClick={() => remoteAuth.cancelSignup()}>
          先不要，登出
        </button>
      </form>
    );
  } else if (me) {
    body = (
      <div className="space-y-4">
        <p className="rounded-xl bg-slate-50 p-3 text-sm text-slate-600">
          你已經登入為 <b>{me.name}</b>（{maskPhone(me.phone)}）。
        </p>
        <button className="btn btn-primary w-full" onClick={() => router.replace(next)}>
          繼續
        </button>
        <button className="btn btn-ghost w-full" onClick={() => actions.logout()}>
          登出，換一個帳號
        </button>
      </div>
    );
  } else if (step === 'id') {
    body = (
      <form onSubmit={send} className="space-y-4">
        {methods.length > 1 && (
          <div className="grid grid-cols-2 gap-1 rounded-xl bg-slate-100 p-1 text-sm font-semibold">
            {methods.map((m) => (
              <button
                key={m}
                type="button"
                aria-pressed={method === m}
                className={`rounded-lg py-2 ${method === m ? 'bg-white shadow-sm' : 'text-slate-500'}`}
                onClick={() => {
                  setMethod(m);
                  setId('');
                  setError('');
                }}
              >
                {m === 'phone' ? '手機簡訊' : 'Email'}
              </button>
            ))}
          </div>
        )}
        <div>
          <label className="label" htmlFor="login-id">
            {label}
          </label>
          <input
            id="login-id"
            className="input text-base"
            inputMode={method === 'phone' ? 'numeric' : 'email'}
            autoComplete={method === 'phone' ? 'tel' : 'email'}
            placeholder={method === 'phone' ? '0912345678' : 'you@example.com'}
            value={id}
            onChange={(e) => setId(e.target.value)}
          />
        </div>
        {error && <p className="text-sm text-m-rose">{error}</p>}
        <button className="btn btn-primary w-full" disabled={busy}>
          {busy ? '寄送中…' : method === 'phone' ? '取得簡訊驗證碼' : '寄送驗證信'}
        </button>
      </form>
    );
  } else {
    body = (
      <form onSubmit={verify} className="space-y-4">
        <p className="text-sm text-slate-600">
          {method === 'phone' ? '驗證碼已傳到' : '驗證信已寄到'} <b>{method === 'phone' ? maskPhone(id) : id}</b>
        </p>
        {method === 'email' && (
          <p className="rounded-xl bg-sky-50 p-3 text-sm text-sky-800">
            輸入信裡的數字驗證碼；如果信裡只有登入連結，直接用這個瀏覽器點連結也可以登入。
          </p>
        )}
        <div>
          <label className="label" htmlFor="code">
            驗證碼
          </label>
          <input
            id="code"
            className="input text-center text-lg tracking-[0.4em]"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={8}
            autoFocus
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
          />
        </div>
        {error && <p className="text-sm text-m-rose">{error}</p>}
        <button className="btn btn-primary w-full" disabled={busy}>
          {busy ? '驗證中…' : '驗證'}
        </button>
        <div className="flex gap-2">
          <button type="button" className="btn btn-ghost flex-1" onClick={() => (setStep('id'), setError(''))}>
            換一個{method === 'phone' ? '號碼' : '信箱'}
          </button>
          <button type="button" className="btn btn-ghost flex-1" disabled={wait > 0 || busy} onClick={() => send()}>
            {wait > 0 ? `${wait} 秒後可重寄` : '重寄一次'}
          </button>
        </div>
      </form>
    );
  }

  return (
    <div className="mx-auto grid max-w-4xl gap-6 md:grid-cols-2">
      <section className="card p-6">
        <div className="mb-5 flex items-center gap-3">
          <span className="flex size-11 items-center justify-center rounded-2xl bg-brand-soft text-brand">
            <Icon className="size-5" />
          </span>
          <div>
            <h1 className="text-xl font-bold">登入／註冊</h1>
            <p className="text-sm text-slate-500">第一次登入會自動建立帳號</p>
          </div>
        </div>
        {body}
        <ConsentNote />
      </section>

      <section className="card p-6 text-sm text-slate-600">
        <h2 className="font-bold text-slate-800">登入說明</h2>
        <ul className="mt-3 list-disc space-y-2 pl-5">
          <li>不用設密碼：每次登入都會寄一組一次性驗證碼。</li>
          <li>一個{methods.includes('phone') ? '手機號碼' : '信箱'}一個帳號。你的{methods.includes('phone') ? '號碼' : '信箱'}不會顯示給其他使用者。</li>
          <li>新帳號送 {d.settings.signupBonus} 點；前 {d.settings.newAccountDays} 天點數交易上限 {d.settings.newAccountPointsCap} 點。</li>
          <li>收不到驗證碼？等 1 分鐘後按「重寄一次」，也檢查一下垃圾郵件匣。</li>
        </ul>
      </section>
    </div>
  );
}
