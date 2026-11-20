import type { AdminLevel, DB, Suspension, User } from './types';

/**
 * Staff levels and suspensions, shared by the demo store, the Supabase layer and
 * the pages. The server enforces the same rules (migration 7, private.require_level).
 */

export const LEVEL_LABEL: Record<AdminLevel | 'member', string> = {
  owner: '擁有者',
  admin: '管理員',
  moderator: '審核員',
  member: '一般會員',
};

export const LEVEL_DUTIES: Record<AdminLevel, string> = {
  owner: '所有後台功能，包括指派管理團隊、修改平台參數和調整點數',
  admin: '審核刊登、處理檢舉與爭議、停權或恢復會員、設定商家',
  moderator: '審核刊登和處理檢舉（駁回或下架刊登）',
};

const LEVEL_RANK: Record<AdminLevel, number> = { moderator: 1, admin: 2, owner: 3 };

/** A staff member's level, or null for members. */
export const levelOf = (u: User | null | undefined): AdminLevel | null =>
  u && u.role === 'admin' ? (u.adminLevel ?? 'owner') : null;

/** An active staff member at `min` or above. */
export const hasLevel = (u: User | null | undefined, min: AdminLevel): boolean => {
  const level = levelOf(u);
  return !!u && u.status === 'active' && !!level && LEVEL_RANK[level] >= LEVEL_RANK[min];
};

export const isStaff = (u: User | null | undefined) => hasLevel(u, 'moderator');

export const levelError = (min: AdminLevel) =>
  min === 'owner' ? '這個操作只有「擁有者」可以執行' : `這個操作需要「${LEVEL_LABEL[min]}」以上的權限`;

/** The suspension in force for a member; without `userId`, any in the list (a member only loads their own). */
export function activeSuspension(d: Pick<DB, 'suspensions'>, userId?: string | null): Suspension | null {
  return (
    d.suspensions
      .filter((s) => !s.liftedAt && (!userId || s.userId === userId))
      .sort((a, b) => b.createdAt - a.createdAt)[0] ?? null
  );
}

const pad = (n: number) => String(n).padStart(2, '0');
export const formatUntil = (t: number) => {
  const x = new Date(t);
  return `${x.getFullYear()}/${pad(x.getMonth() + 1)}/${pad(x.getDate())} ${pad(x.getHours())}:${pad(x.getMinutes())}`;
};

/** What a suspended member sees; matches the server's private.suspension_note. */
export function suspensionNote(s: Suspension | null): string {
  const reason = s?.reason ? `，原因：${s.reason}` : '';
  if (!s?.until) return `這個帳號已被停權${reason}。如需協助，請聯絡 Myrs 客服。`;
  return `這個帳號已被停權${reason}。將在 ${formatUntil(s.until)} 自動恢復。`;
}
