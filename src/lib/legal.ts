/**
 * Facts the terms (/terms) and the privacy policy (/privacy) need that the code cannot know.
 * Fill them in before the formal launch; an empty value shows as 「待補」 on the pages.
 * Both pages are drafts for a lawyer to review, not legal advice.
 */
export const LEGAL = {
  /** Shown at the top of both pages; change it whenever either text changes. */
  updated: '2026 年 11 月 21 日',
  /** Who runs Myrs: a person's name, or a company's name and tax ID. */
  operator: '',
  /** Where members write for help, appeals and personal-data requests. */
  contactEmail: '',
  /** How long finished trades, the points ledger, chats and disputes are kept after an account is deleted. */
  retention: '',
  /** Supabase project region (dashboard → Settings → General → Project region). */
  dataRegion: '日本東京',
};
