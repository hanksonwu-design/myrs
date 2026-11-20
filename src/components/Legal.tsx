'use client';

import Link from 'next/link';
import { FileWarning } from 'lucide-react';
import { LEGAL } from '@/lib/legal';
import { IS_REMOTE } from '@/lib/backend';
import { PageTitle } from './ui';

/** A fact still to be decided, highlighted so nobody mistakes the draft for final. */
export function Fill({ value, what }: { value: string; what: string }) {
  if (value) return <>{value}</>;
  return <mark className="rounded bg-amber-100 px-1 text-amber-800">【待補：{what}】</mark>;
}

export const Operator = () => <Fill value={LEGAL.operator} what="營運者名稱" />;
export const Contact = () => <Fill value={LEGAL.contactEmail} what="聯絡信箱" />;

export interface Clause {
  title: string;
  body: React.ReactNode;
}

const OTHER = {
  terms: { href: '/privacy', label: '隱私權政策' },
  privacy: { href: '/terms', label: '使用條款' },
};

/** The page frame both documents share: title, draft notice, numbered clauses. */
export function LegalDoc({ kind, title, intro, clauses }: { kind: keyof typeof OTHER; title: string; intro: React.ReactNode; clauses: Clause[] }) {
  const other = OTHER[kind];
  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <PageTitle sub={`最後更新：${LEGAL.updated}`}>{title}</PageTitle>

      <div className="flex gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
        <FileWarning className="mt-0.5 size-5 shrink-0" />
        <p>
          這是<b>草稿</b>，還沒有經過律師審閱，正式上線前可能會修改；有重大修改時會在網站公告。標成黃色的地方是還沒決定的內容。
          {!IS_REMOTE && ' 你現在看的是示範版：示範版的資料只存在這個瀏覽器裡，不會上傳。'}
        </p>
      </div>

      <section className="card p-5 text-sm leading-relaxed text-slate-600">{intro}</section>

      {clauses.map((c, i) => (
        <section key={c.title} className="card p-5">
          <h2 className="mb-2 font-bold text-slate-800">
            第 {i + 1} 條　{c.title}
          </h2>
          <div className="space-y-2 text-sm leading-relaxed text-slate-600 [&_li]:pl-0.5 [&_ol]:list-decimal [&_ol]:space-y-1 [&_ol]:pl-5 [&_ul]:list-disc [&_ul]:space-y-1 [&_ul]:pl-5">
            {c.body}
          </div>
        </section>
      ))}

      <div className="flex flex-wrap justify-center gap-2 pb-2">
        <Link href={other.href} className="btn btn-outline">
          看{other.label}
        </Link>
        <Link href="/about" className="btn btn-outline">
          關於與規則
        </Link>
      </div>
    </div>
  );
}

/** Under the login form. Opens in a new tab so a half-typed code is not lost. */
export function ConsentNote() {
  const link = 'underline underline-offset-2 hover:text-brand';
  return (
    <p className="mt-5 text-xs leading-relaxed text-slate-400">
      註冊即表示同意
      <Link href="/terms" target="_blank" className={link}>
        使用條款
      </Link>
      與
      <Link href="/privacy" target="_blank" className={link}>
        隱私權政策
      </Link>
      。點數只能在 Myrs 內使用，不能兌換現金或轉帳給他人。
    </p>
  );
}
