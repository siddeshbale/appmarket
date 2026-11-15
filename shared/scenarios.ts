// Monetization Scenarios: user-supplied inputs only. Outputs are labeled "Modeled" and are never
// presented as measurements of any competitor.

export type ScenarioModel = 'subscription' | 'iap_payers' | 'ads_ecpm' | 'paid_download';

export interface ScenarioRange {
  low: number | null;
  base: number | null;
  high: number | null;
}

export interface ScenarioInputs {
  model: ScenarioModel;
  currency: string;
  values: Record<string, ScenarioRange>;
  /** Optional user-provided conversion rate (1 unit of `currency` = fxRate units of fxCurrency). */
  fxRate?: number | null;
  fxCurrency?: string;
}

export interface ScenarioDefinition {
  model: ScenarioModel;
  title: string;
  formula: string;
  inputs: { key: string; label: string; unit: string; max?: number }[];
  excludes: string[];
  compute: (v: Record<string, number>) => number;
}

export const SCENARIOS: ScenarioDefinition[] = [
  {
    model: 'iap_payers',
    title: 'In-app purchases (payers × spend)',
    formula: 'monthly gross = active payers × monthly spend per payer',
    inputs: [
      { key: 'payers', label: 'Active payers per month', unit: 'people' },
      { key: 'spend', label: 'Monthly spend per payer', unit: 'currency / month' },
    ],
    excludes: ['Store commission', 'Taxes / VAT', 'Refunds & chargebacks', 'Marketing and operating costs'],
    compute: (v) => v.payers * v.spend,
  },
  {
    model: 'subscription',
    title: 'Subscriptions',
    formula: 'monthly gross = paying subscribers × monthly price × (1 − share on free/discounted terms)',
    inputs: [
      { key: 'subs', label: 'Paying subscribers', unit: 'people' },
      { key: 'price', label: 'Monthly price (normalized)', unit: 'currency / month' },
      { key: 'discountShare', label: 'Share on free/discounted terms', unit: 'fraction 0–1', max: 1 },
    ],
    excludes: ['Store commission (often 15–30%)', 'Taxes / VAT', 'Refunds', 'Churn within the month', 'Operating costs'],
    compute: (v) => v.subs * v.price * (1 - v.discountShare),
  },
  {
    model: 'ads_ecpm',
    title: 'Advertising (impressions × eCPM)',
    formula: 'monthly gross = impressions per month ÷ 1,000 × eCPM',
    inputs: [
      { key: 'impressions', label: 'Ad impressions per month', unit: 'impressions' },
      { key: 'ecpm', label: 'eCPM', unit: 'currency per 1,000 impressions' },
    ],
    excludes: ['Network / mediation fees not reflected in eCPM', 'Taxes', 'Invalid-traffic clawbacks', 'Operating costs'],
    compute: (v) => (v.impressions / 1000) * v.ecpm,
  },
  {
    model: 'paid_download',
    title: 'Paid downloads',
    formula: 'monthly gross = paid downloads per month × list price',
    inputs: [
      { key: 'downloads', label: 'Paid downloads per month', unit: 'downloads' },
      { key: 'price', label: 'List price', unit: 'currency' },
    ],
    excludes: ['Store commission', 'Taxes / VAT', 'Regional price tiers', 'Refunds'],
    compute: (v) => v.downloads * v.price,
  },
];

export type ScenarioResult =
  | { status: 'no_data'; missing: string[] }
  | {
      status: 'ok';
      low: number;
      base: number;
      high: number;
      currency: string;
      converted?: { low: number; base: number; high: number; currency: string; rate: number };
    };

export function emptyScenarioValues(model: ScenarioModel): Record<string, ScenarioRange> {
  const def = SCENARIOS.find((d) => d.model === model)!;
  return Object.fromEntries(def.inputs.map((i) => [i.key, { low: null, base: null, high: null }]));
}

export function runScenario(inp: ScenarioInputs): ScenarioResult {
  const def = SCENARIOS.find((d) => d.model === inp.model);
  if (!def) return { status: 'no_data', missing: ['model'] };
  const missing: string[] = [];
  const pick = (level: 'low' | 'base' | 'high') => {
    const out: Record<string, number> = {};
    for (const i of def.inputs) {
      const raw = inp.values[i.key]?.[level];
      if (raw === null || raw === undefined || !Number.isFinite(raw) || raw < 0 || (i.max !== undefined && raw > i.max)) {
        missing.push(`${i.label} (${level})`);
        out[i.key] = NaN;
      } else out[i.key] = raw;
    }
    return out;
  };
  const lo = pick('low');
  const ba = pick('base');
  const hi = pick('high');
  if (missing.length) return { status: 'no_data', missing };
  const res: ScenarioResult = { status: 'ok', low: def.compute(lo), base: def.compute(ba), high: def.compute(hi), currency: inp.currency };
  if (inp.fxRate && inp.fxRate > 0 && inp.fxCurrency && inp.fxCurrency !== inp.currency) {
    res.converted = { low: res.low * inp.fxRate, base: res.base * inp.fxRate, high: res.high * inp.fxRate, currency: inp.fxCurrency, rate: inp.fxRate };
  }
  return res;
}
