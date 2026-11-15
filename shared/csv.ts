// CSV helpers: RFC 4180 parsing and safe serialization with spreadsheet formula-injection guards.

const FORMULA_START = /^[=+\-@\t\r|]/;

/** Neutralize string cells that a spreadsheet would execute as a formula. Real numbers are left as-is. */
export function guardCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  const s = typeof value === 'object' ? JSON.stringify(value) : String(value);
  return FORMULA_START.test(s) ? "'" + s : s;
}

function quote(s: string): string {
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

export function toCsv(rows: Record<string, unknown>[], columns?: string[]): string {
  const cols =
    columns ??
    Array.from(
      rows.reduce((set, r) => {
        Object.keys(r).forEach((k) => set.add(k));
        return set;
      }, new Set<string>()),
    );
  const lines = [cols.map((c) => quote(guardCell(c))).join(',')];
  for (const r of rows) lines.push(cols.map((c) => quote(guardCell(r[c]))).join(','));
  return lines.join('\r\n') + '\r\n';
}

export function parseCsv(text: string, maxRows = 50000): { header: string[]; rows: Record<string, string>[] } {
  const src = text.replace(new RegExp('^\uFEFF'), '');
  const records: string[][] = [];
  let field = '';
  let rec: string[] = [];
  let inQ = false;
  let wasQuoted = false;
  const endRecord = () => {
    rec.push(field);
    field = '';
    if (rec.length > 1 || rec[0] !== '' || wasQuoted) records.push(rec);
    rec = [];
    wasQuoted = false;
    if (records.length > maxRows + 1) throw new Error(`Too many rows (max ${maxRows})`);
  };
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inQ) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else inQ = false;
      } else field += ch;
      continue;
    }
    if (ch === '"' && field === '') {
      inQ = true;
      wasQuoted = true;
      continue;
    }
    if (ch === ',') {
      rec.push(field);
      field = '';
      continue;
    }
    if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      endRecord();
      continue;
    }
    field += ch;
  }
  if (inQ) throw new Error('Unterminated quoted field');
  if (field !== '' || rec.length) endRecord();
  const header = (records.shift() ?? []).map((h) => h.trim());
  const rows = records.map((r) => Object.fromEntries(header.map((h, idx) => [h, (r[idx] ?? '').trim()])));
  return { header, rows };
}
