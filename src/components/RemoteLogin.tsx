'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Mail, ShieldAlert, Smartphone } from 'lucide-react';
import { actions, currentUser } from '@/lib/store';
import { remoteAuth, type LoginMethod } from '@/lib/remote';
import { GOOGLE_LOGIN, LOGIN_METHODS } from '@/lib/backend';
import { useInstall } from '@/lib/install';
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

/** Where to go after the Google round trip: Google sends people back to plain /login, without ?next=. */
const GOOGLE_KEY = 'myrs-google-login';
const GOOGLE_TTL_MS = 15 * 60 * 1000;

function saveGoogleNext(next: string) {
  try {
    sessionStorage.setItem(GOOGLE_KEY, JSON.stringify({ next, at: Date.now() }));
  } catch {
    // Private browsing without storage: the member lands on the home page instead.
  }
}

function readGoogleNext(): string | null {
  try {
    const { next, at } = JSON.parse(sessionStorage.getItem(GOOGLE_KEY) ?? 'null') ?? {};
    const fresh = typeof at === 'number' && Date.now() - at < GOOGLE_TTL_MS;
    return fresh && typeof next === 'string' && next.startsWith('/') && !next.startsWith('//') ? next : null;
  } catch {
    return null;
  }
}

function clearGoogleNext() {
  try {
    sessionStorage.removeItem(GOOGLE_KEY);
  } catch {
    // nothing saved
  }
}

/** The error Supabase put in the address after a failed Google or e-mail-link login; removes it from the address. */
function takeUrlError(): string {
  const url = new URL(window.location.href);
  const hash = new URLSearchParams(url.hash.slice(1));
  const keys = ['error', 'error_code', 'error_description'];
  if (!keys.some((k) => url.searchParams.has(k) || hash.has(k))) return '';
  const code =
    url.searchParams.get('error_code') || hash.get('error_code') || url.searchParams.get('error') || hash.get('error');
  keys.forEach((k) => url.searchParams.delete(k));
  window.history.replaceState(window.history.state, '', url.pathname + url.search);
  return code || 'unknown';
}

/** Google's four-colour "G", which its sign-in button guidelines ask for. */
function GoogleMark() {
  return (
    <svg viewBox="0 0 48 48" className="size-5 shrink-0" aria-hidden>
      <path
        fill="#EA4335"
        d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
      />
      <path
        fill="#4285F4"
        d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
      />
      <path
        fill="#FBBC05"
        d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
      />
      <path
        fill="#34A853"
        d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
      />
    </svg>
  );
}

/** Supabase Auth sign-in: Google, or a one-time code by SMS or e-mail; first login creates the account. */
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
  const [googleNext, setGoogleNext] = useState<string | null>(null);
  const [leaving, setLeaving] = useState(false);
  const [notice, setNotice] = useState('');
  const install = useInstall();
  const inApp = install?.platform === 'inapp' ? install.appName : '';
  const me = currentUser(d);
  const state = d.auth?.state;
  const target = googleNext ?? next;

  useEffect(() => setInvite(pendingInvite()), []);

  useEffect(() => {
    // Coming back from Google: the address is plain /login, so take the page saved before leaving.
    const back = new URLSearchParams(window.location.search).has('next') ? null : readGoogleNext();
    if (!back) clearGoogleNext();
    setGoogleNext(back);
    const err = takeUrlError();
    if (err)
      setNotice(
        back
          ? 'Google 登入沒有完成，請再試一次，或改用下面的 Email 登入。'
          : err === 'otp_expired'
            ? '登入連結已經過期或用過了，請重新寄一次驗證信。'
            : '登入沒有完成，請再試一次。',
      );
    // Back from Google's page with the browser's back button: the page comes back as it was left.
    const shown = (e: PageTransitionEvent) => e.persisted && setLeaving(false);
    window.addEventListener('pageshow', shown);
    return () => window.removeEventListener('pageshow', shown);
  }, []);

  useEffect(() => {
    if (!googleNext || !state) return;
    if (state === 'suspended') return clearGoogleNext();
    if (state !== 'ok') return; // needs_signup: the nickname form below finishes it
    clearGoogleNext();
    setGoogleNext(null);
    toast('歡迎回來！');
    router.replace(googleNext);
  }, [googleNext, state, router, toast]);

  useEffect(() => {
    if (wait <= 0) return;
    const t = setTimeout(() => setWait((w) => w - 1), 1000);
    return () => clearTimeout(t);
  }, [wait]);

  const done = (msg: string) => {
    clearGoogleNext();
    toast(msg);
    router.replace(target);
  };

  const google = async () => {
    setNotice('');
    setLeaving(true);
    saveGoogleNext(target);
    const r = await remoteAuth.signInWithGoogle();
    if (r.ok) return; // the browser is on its way to Google
    setLeaving(false);
    clearGoogleNext();
    setNotice(r.error);
  };

  /** LINE opens a link in the phone's own browser when it ends with openExternalBrowser=1. */
  const openInBrowser = () => {
    const url = new URL(window.location.href);
    url.searchParams.set('openExternalBrowser', '1');
    window.location.href = url.toString();
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
          <p className="mt-1 text-xs text-slate-500">暱稱會顯示給其他人看，不用填本名。</p>
        </div>
        <InviteCodeField value={invite} onChange={setInvite} />
        {error && <p className="text-sm text-m-rose">{error}</p>}
        <button className="btn btn-primary w-full" disabled={busy}>
          {busy ? '建立中…' : '完成註冊'}
        </button>
        <button
          type="button"
          className="btn btn-ghost w-full"
          onClick={() => {
            clearGoogleNext();
            remoteAuth.cancelSignup();
          }}
        >
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
        <button className="btn btn-primary w-full" onClick={() => router.replace(target)}>
          繼續
        </button>
        <button className="btn btn-ghost w-full" onClick={() => actions.logout()}>
          登出，換一個帳號
        </button>
      </div>
    );
  } else if (step === 'id') {
    const codeWay =
      methods.length > 1 ? '或收驗證碼登入' : methods[0] === 'phone' ? '或用手機簡訊驗證碼登入' : '或用 Email 驗證碼登入';
    body = (
      <>
        {GOOGLE_LOGIN && (
          <div className="mb-5 space-y-4">
            {inApp ? (
              <div className="space-y-2 rounded-xl bg-amber-50 p-3 text-sm leading-relaxed text-amber-800">
                <p>
                  在 {inApp} 裡面不能用 Google 登入。
                  {inApp === 'LINE'
                    ? '請先用手機的瀏覽器打開 Myrs，或直接用下面的 Email 登入。'
                    : '請點右上角的「⋯」選單，選「用瀏覽器開啟」，或直接用下面的 Email 登入。'}
                </p>
                {inApp === 'LINE' && (
                  <button type="button" className="btn btn-outline w-full" onClick={openInBrowser}>
                    用瀏覽器打開
                  </button>
                )}
              </div>
            ) : (
              <button
                type="button"
                className="btn btn-outline w-full gap-2.5 py-3 text-base"
                disabled={leaving}
                onClick={google}
              >
                <GoogleMark />
                {leaving ? '正在前往 Google…' : '使用 Google 帳戶登入'}
              </button>
            )}
            <div className="flex items-center gap-3 text-xs text-slate-400">
              <span className="h-px flex-1 bg-slate-200" />
              {codeWay}
              <span className="h-px flex-1 bg-slate-200" />
            </div>
          </div>
        )}
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
      </>
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
        {notice && (
          <p role="alert" className="mb-4 rounded-xl bg-rose-50 p-3 text-sm text-m-rose">
            {notice}
          </p>
        )}
        {body}
        <ConsentNote />
      </section>

      <section className="card p-6 text-sm text-slate-600">
        <h2 className="font-bold text-slate-800">登入說明</h2>
        <ul className="mt-3 list-disc space-y-2 pl-5">
          {GOOGLE_LOGIN && <li>有 Google 帳戶（Gmail）最快：按「使用 Google 帳戶登入」、選帳戶就好，不用等驗證信。</li>}
          <li>{GOOGLE_LOGIN ? '用驗證碼登入也不用設密碼' : '不用設密碼'}：登入時會寄一組一次性驗證碼。</li>
          <li>同一個瀏覽器登入過就會記住，下次打開不用再登入；換手機、換瀏覽器或登出後才要再登入一次。</li>
          <li>
            一個{methods.includes('phone') ? '手機號碼' : '信箱'}一個帳號
            {GOOGLE_LOGIN && !methods.includes('phone') && '：用 Google 登入和用同一個 Gmail 收驗證碼，會進到同一個帳號'}。你的
            {methods.includes('phone') ? '號碼' : '信箱'}不會顯示給其他使用者。
          </li>
          <li>新帳號送 {d.settings.signupBonus} 點；前 {d.settings.newAccountDays} 天點數交易上限 {d.settings.newAccountPointsCap} 點。</li>
          <li>收不到驗證碼？等 1 分鐘後按「重寄一次」，也檢查一下垃圾郵件匣。</li>
        </ul>
      </section>
    </div>
  );
}
