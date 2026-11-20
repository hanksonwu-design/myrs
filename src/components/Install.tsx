'use client';

import { useEffect, useState } from 'react';
import { Download, Smartphone, X } from 'lucide-react';
import { promptInstall, useInstall, type InstallState } from '@/lib/install';
import { Modal } from './ui';
import { useToast } from './Providers';

const HIDE_KEY = 'myrs-install-hide';
const HIDE_DAYS = 30;

/** Step-by-step, for the browser the member is using. */
export function InstallSteps({ state }: { state: InstallState }) {
  const steps: Record<InstallState['platform'], string[]> = {
    ios: [
      '點瀏覽器的「分享」按鈕（方框加向上箭頭；Safari 在畫面下方，Chrome 在網址列右邊）。',
      '往下滑，選「加入主畫面」。',
      '按右上角的「新增」。',
    ],
    android: ['點瀏覽器右上角的「⋮」選單。', '選「加到主畫面」或「安裝應用程式」。', '按「安裝」或「新增」。'],
    inapp: [
      `${state.appName} 裡的瀏覽器不能加到主畫面。先點右上角的選單（⋯ 或 ⋮）。`,
      '選「用預設瀏覽器開啟」或「在 Safari／Chrome 中開啟」。',
      '在瀏覽器裡打開後，再照那個瀏覽器的方法加到主畫面。',
    ],
    desktop: ['在 Chrome 或 Edge 網址列的右邊，點「安裝」圖示。', '按「安裝」。'],
  };
  return (
    <div className="space-y-3 text-sm text-slate-700">
      <ol className="list-decimal space-y-1.5 pl-5">
        {steps[state.platform].map((s) => (
          <li key={s}>{s}</li>
        ))}
      </ol>
      {state.platform === 'ios' && (
        <p className="rounded-xl bg-slate-50 p-3 text-xs text-slate-500">
          iPhone 從主畫面打開時，第一次要再登入一次（一樣用 Email 驗證碼），之後就會記住。
        </p>
      )}
    </div>
  );
}

/** Install now when the browser allows it, otherwise show how. */
function useInstallAction(state: InstallState | null) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const run = async () => {
    if (state?.canPrompt) {
      if (await promptInstall()) toast('已加到主畫面，之後可以從主畫面打開 Myrs');
      return;
    }
    setOpen(true);
  };
  const modal = state && (
    <Modal open={open} title="把 Myrs 加到主畫面" onClose={() => setOpen(false)}>
      <InstallSteps state={state} />
    </Modal>
  );
  return { run, modal, label: state?.canPrompt ? '安裝' : '怎麼加' };
}

/** Worth offering: not installed yet, and either a phone or a browser that can install. */
const offerable = (s: InstallState | null): s is InstallState =>
  !!s && !s.standalone && (s.platform !== 'desktop' || s.canPrompt);

/** For 「我的」. */
export function InstallCard() {
  const state = useInstall();
  const { run, modal, label } = useInstallAction(state);
  if (!offerable(state)) return null;
  return (
    <section className="card flex items-center gap-3 p-5">
      <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-brand-soft text-brand">
        <Smartphone className="size-5" />
      </span>
      <div className="min-w-0 flex-1">
        <h2 className="font-bold">把 Myrs 加到主畫面</h2>
        <p className="text-sm text-slate-600">像 App 一樣從主畫面打開，不用再找網址；有新通知，打開就看得到。</p>
      </div>
      <button className="btn btn-primary shrink-0" onClick={run}>
        {state.canPrompt && <Download className="size-4" />}
        {label}
      </button>
      {modal}
    </section>
  );
}

/** One line on the home page for members on a phone; hidden for 30 days when closed. */
export function InstallBanner() {
  const state = useInstall();
  const { run, modal, label } = useInstallAction(state);
  const [hidden, setHidden] = useState(true);
  useEffect(() => {
    const at = Number(localStorage.getItem(HIDE_KEY) ?? 0);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setHidden(Date.now() - at < HIDE_DAYS * 86_400_000);
  }, []);
  if (hidden || !offerable(state) || state.platform === 'desktop') return null;
  const hide = () => {
    localStorage.setItem(HIDE_KEY, String(Date.now()));
    setHidden(true);
  };
  return (
    <div className="mb-4 flex items-center gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm">
      <Smartphone className="size-5 shrink-0 text-brand" />
      <span className="min-w-0 flex-1 text-slate-700">加到主畫面，像 App 一樣打開</span>
      <button className="btn btn-outline shrink-0 px-3 py-1 text-sm" onClick={run}>
        {label}
      </button>
      <button className="shrink-0 p-1 text-slate-400 hover:text-slate-600" onClick={hide} aria-label="不要再顯示">
        <X className="size-4" />
      </button>
      {modal}
    </div>
  );
}
