export const ZAT_PER_ZEC = 100_000_000;

export const zatToNgn = (zat: number, zecNgn: number) => Math.round((zat / ZAT_PER_ZEC) * zecNgn);
export const ngnToZat = (ngn: number, zecNgn: number) => Math.round((ngn / zecNgn) * ZAT_PER_ZEC);

/** "₦50,000" */
export const formatNgn = (ngn: number) => `₦${Math.round(ngn).toLocaleString("en-US")}`;

/** "₦1.2M", "₦850K" for chart axes. */
export function compactNgn(ngn: number): string {
  if (ngn >= 1_000_000) return `₦${(ngn / 1_000_000).toFixed(ngn >= 10_000_000 ? 0 : 1).replace(/\.0$/, "")}M`;
  if (ngn >= 1_000) return `₦${Math.round(ngn / 1_000)}K`;
  return formatNgn(ngn);
}

/** "0.8333 ZEC" (rounded down to `decimals`). */
export function formatZec(zat: number, decimals = 4): string {
  const zec = Math.floor(zat / 10 ** (8 - decimals)) / 10 ** decimals;
  return `${zec.toLocaleString("en-US", { minimumFractionDigits: Math.min(2, decimals), maximumFractionDigits: decimals })} ZEC`;
}

/** "1 November 2026" */
export const formatDate = (iso: string) =>
  new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });

/** "Sunday, 1 November" */
export const formatDateFriendly = (iso: string) =>
  new Date(iso).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });

/** "25 Oct, 14:05" */
export const formatDateTime = (iso: string) =>
  new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

/** "19 Oct" */
export const formatWeek = (isoDate: string) =>
  new Date(`${isoDate}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });

export function timeAgo(iso: string, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86_400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86_400)} d ago`;
}

export const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
