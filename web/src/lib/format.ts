export const PLATFORM_LABEL: Record<string, string> = { ios: 'App Store', android: 'Google Play' };
export const DEVICE_LABEL: Record<string, string> = { iphone: 'iPhone', ipad: 'iPad', unspecified: 'Device unspecified', android_phone: 'Android' };
export const CHART_LABEL: Record<string, string> = { free: 'Top Free', paid: 'Top Paid', grossing: 'Top Grossing' };

export function fmtNum(n: number | null | undefined, digits = 0): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  return n.toLocaleString('en-US', { maximumFractionDigits: digits, minimumFractionDigits: digits });
}
export function fmtCompact(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  return Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(n);
}
export function fmtPrice(p: number | null | undefined, cur: string | null | undefined): string {
  if (p === null || p === undefined) return '—';
  if (p === 0) return 'Free';
  return `${p.toLocaleString('en-US', { maximumFractionDigits: 2 })} ${cur ?? ''}`.trim();
}
export function fmtDay(s: string | null | undefined): string {
  return s ? String(s).slice(0, 10) : '—';
}
export function scopeLabel(s: any, categoryName?: string): string {
  if (!s) return '';
  const cat = s.category === 'all' ? 'All categories' : (categoryName ?? s.categoryName ?? `Category ${s.category}`);
  const src = s.provenance === 'imported' ? ' · imported' : s.provenance === 'user' ? ' · manual' : s.provenance === 'demo' ? ' · DEMO' : '';
  return `${PLATFORM_LABEL[s.platform] ?? s.platform} ${String(s.market).toUpperCase()} · ${DEVICE_LABEL[s.device] ?? s.device} · ${CHART_LABEL[s.chartType] ?? s.chartType} · ${cat}${src}`;
}
export function today(): string {
  return new Date().toISOString().slice(0, 10);
}
