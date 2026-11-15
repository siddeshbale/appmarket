// Keyword Lab helpers. Frequencies are computed WITHIN the selected tracked sample only —
// they say nothing about store-wide search volume or difficulty.

const STOP = new Set(
  (
    'a an and are as at be by for from has have in into is it its of on or our that the this to with you your we us ' +
    'will can all more new get app apps use using one any not no now just also up out than then so if do does ' +
    'my me i what how who which when where why best free most very each every other only over about'
  ).split(/\s+/),
);

export function tokenize(text: string): string[] {
  return (text || '')
    .toLowerCase()
    .normalize('NFKC')
    .replace(/https?:\/\/\S+/g, ' ')
    .split(/[^\p{L}\p{N}']+/u)
    .map((t) => t.replace(/^'+|'+$/g, ''))
    .filter((t) => t.length >= 2 && !/^\d+$/.test(t));
}

export function ngrams(tokens: string[], n: number): string[] {
  const out: string[] = [];
  for (let i = 0; i + n <= tokens.length; i++) {
    const g = tokens.slice(i, i + n);
    if (STOP.has(g[0]) || STOP.has(g[g.length - 1])) continue;
    out.push(g.join(' '));
  }
  return out;
}

export interface TermStat {
  term: string;
  n: number;
  /** listings in the sample whose text contains the term */
  docFreq: number;
  /** total occurrences in the sample */
  occurrences: number;
  inTitles: number;
  sampleSize: number;
  /** docFreq / sampleSize */
  share: number;
}

export interface SampleDoc {
  id: number | string;
  title: string;
  text: string; // subtitle/description/keywords the user is allowed to analyze
}

export function termStats(docs: SampleDoc[], opts: { maxN?: number; minDocFreq?: number; limit?: number } = {}): TermStat[] {
  const maxN = opts.maxN ?? 3;
  const minDf = opts.minDocFreq ?? 2;
  const map = new Map<string, TermStat>();
  for (const d of docs) {
    const titleTokens = tokenize(d.title);
    const allTokens = [...titleTokens, ...tokenize(d.text)];
    const seen = new Set<string>();
    const titleTerms = new Set<string>();
    for (let n = 1; n <= maxN; n++) {
      ngrams(titleTokens, n).forEach((t) => titleTerms.add(t));
      for (const t of ngrams(allTokens, n)) {
        if (n === 1 && STOP.has(t)) continue;
        let st = map.get(t);
        if (!st) {
          st = { term: t, n, docFreq: 0, occurrences: 0, inTitles: 0, sampleSize: docs.length, share: 0 };
          map.set(t, st);
        }
        st.occurrences++;
        if (!seen.has(t)) {
          seen.add(t);
          st.docFreq++;
          if (titleTerms.has(t)) st.inTitles++;
        }
      }
    }
  }
  const out = [...map.values()].filter((s) => s.docFreq >= Math.min(minDf, docs.length));
  out.forEach((s) => (s.share = docs.length ? s.docFreq / docs.length : 0));
  out.sort((a, b) => b.docFreq - a.docFreq || b.inTitles - a.inTitles || b.n - a.n || a.term.localeCompare(b.term));
  return out.slice(0, opts.limit ?? 200);
}

/**
 * Heuristic "sample crowding" signal — NOT search volume and NOT an official ASO difficulty score.
 * crowding = (listings in sample using the term in their title) / sampleSize, in [0,1].
 */
export const CROWDING_FORMULA = 'crowding = listings in the tracked sample with the term in their title ÷ sample size';
export function crowding(s: TermStat): number {
  return s.sampleSize ? s.inTitles / s.sampleSize : 0;
}
