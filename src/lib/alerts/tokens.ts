import { redditAvatar } from "@/lib/redditAvatar";

/**
 * The light theme of `src/styles/tokens.css` converted to sRGB hex, because an
 * email client cannot read a CSS variable and most cannot parse `oklch()`.
 * Each value is the same colour the app paints; change a token there and this
 * table is the one place the email follows it.
 */
export const EMAIL_COLORS = {
  /** --bg oklch(0.985 0.002 90) */
  bg: "#fafaf9",
  /** --surface oklch(1 0 0) */
  surface: "#ffffff",
  /** --surface-2 oklch(0.96 0.003 90) */
  surface2: "#f2f2ef",
  /** --border oklch(0.90 0 0) */
  border: "#dedede",
  /** --fg oklch(0.208 0 0) */
  fg: "#181818",
  /** --fg-muted oklch(0.50 0 0) */
  fgMuted: "#636363",
  /** --score-hot oklch(0.62 0.17 145) */
  scoreHot: "#2f9f3d",
  /** --score-warm oklch(0.75 0.15 75) */
  scoreWarm: "#e49e22",
  /** --reddit oklch(0.66 0.20 40) */
  reddit: "#f25914",
  /** The blue of the mark in src/app/icon.svg, for the one button an email asks you to press. */
  brand: "#1f4fe0",
} as const;

/** --radius-card and --radius-control, in the units an email understands. */
export const EMAIL_RADIUS = { card: "16px", control: "12px" } as const;

/** Single quotes on purpose: this string lives inside a double-quoted attribute. */
export const EMAIL_FONT =
  "'Instrument Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif";

const ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ESCAPES[character]);
}

/** The colour a score is printed in, matching the feed's score badge. */
export function scoreColor(score: number): string {
  if (score >= 80) {
    return EMAIL_COLORS.scoreHot;
  }
  return score >= 60 ? EMAIL_COLORS.scoreWarm : EMAIL_COLORS.fgMuted;
}

export function hourLabel(hour: number): string {
  if (hour === 0) {
    return "12am";
  }
  return hour < 12 ? `${hour}am` : hour === 12 ? "12pm" : `${hour - 12}pm`;
}

export function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

export function initials(name: string | null): string {
  const cleaned = (name ?? "").replace(/[^a-z0-9]/gi, "");
  return cleaned ? cleaned.slice(0, 2).toUpperCase() : "?";
}

/**
 * A round face at any size: the real picture when we have one, the first two
 * letters of the name when we do not.
 */
export function avatarHtml(name: string | null, src: string | null, size: number): string {
  const radius = `${size / 2}px`;
  // Every face in an email is a Reddit author's.
  src = redditAvatar(name, src);
  if (src) {
    return `<img src="${escapeHtml(src)}" width="${size}" height="${size}" alt="" style="display:block;width:${size}px;height:${size}px;border-radius:${radius};border:1px solid ${EMAIL_COLORS.border};object-fit:cover" />`;
  }
  return `<div style="width:${size}px;height:${size}px;line-height:${size}px;border-radius:${radius};background:${EMAIL_COLORS.surface2};border:1px solid ${EMAIL_COLORS.border};color:${EMAIL_COLORS.fgMuted};font-family:${EMAIL_FONT};font-size:${Math.round(size * 0.36)}px;font-weight:500;text-align:center">${escapeHtml(initials(name))}</div>`;
}
