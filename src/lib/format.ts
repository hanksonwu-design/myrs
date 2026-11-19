export const HOUR = 3_600_000;
export const DAY = 24 * HOUR;

export function ymdLocal(t: number): string {
  const d = new Date(t);
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

/** Whole days from `now` (local date) until a YYYY-MM-DD date. */
export function daysUntil(ymd: string, now: number): number {
  const [y, m, d] = ymd.split('-').map(Number);
  const target = new Date(y, m - 1, d).getTime();
  const n = new Date(now);
  const today = new Date(n.getFullYear(), n.getMonth(), n.getDate()).getTime();
  return Math.round((target - today) / DAY);
}

export function expiryLabel(ymd: string, now: number): string {
  const n = daysUntil(ymd, now);
  if (n < 0) return '已過期';
  if (n === 0) return '今天到期';
  if (n === 1) return '明天到期';
  if (n === 2) return '後天到期';
  if (n <= 30) return `${n} 天後到期`;
  return `到期日 ${ymd.replaceAll('-', '/')}`;
}

export function formatDistance(km: number): string {
  if (km < 1) return `約 ${Math.max(100, Math.round((km * 1000) / 100) * 100)} 公尺`;
  return `約 ${km.toFixed(1)} 公里`;
}

export function timeAgo(t: number, now: number): string {
  const s = Math.max(0, Math.floor((now - t) / 1000));
  if (s < 60) return '剛剛';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} 分鐘前`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} 小時前`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d} 天前`;
  return formatDate(t);
}

export function formatDate(t: number): string {
  const d = new Date(t);
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
}

export function formatDateTime(t: number): string {
  const d = new Date(t);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${d.getMonth() + 1}/${d.getDate()} ${hh}:${mm}`;
}

export function formatTime(t: number): string {
  const d = new Date(t);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export function maskPhone(p: string): string {
  if (!p) return '—';
  return p.length === 10 ? `${p.slice(0, 4)}-***-${p.slice(7)}` : p;
}

export function hoursLeft(deadline: number, now: number): string {
  const h = Math.max(0, Math.ceil((deadline - now) / HOUR));
  return h >= 1 ? `${h} 小時` : '不到 1 小時';
}
