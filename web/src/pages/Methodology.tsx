import { useMeta } from '../lib/meta';

export default function Methodology() {
  const meta = useMeta();
  return (
    <div style={{ maxWidth: 860 }}>
      <h1>Methodology</h1>
      <p className="sub">How App Market Radar collects, labels and compares data — in plain language.</p>

      <h2>What the numbers are (and are not)</h2>
      <ul>
        <li><strong>Ranks</strong> are positions in one chart: a specific store, country, device, chart type (free / paid / grossing) and category, on one provider day. A rank is not a download count. <em>Top grossing is a rank, not money.</em></li>
        <li><strong>Rating counts</strong> are cumulative store ratings in the stated scope. They are not downloads, and growth in ratings is not growth in installs.</li>
        <li><strong>Install thresholds</strong> (Google Play, e.g. “1M+”) are lifetime lower bounds as displayed. They are never shown as exact or monthly installs.</li>
        <li><strong>Prices</strong> are list prices in the stated currency. Price is not revenue. Disclosed ads / in-app purchases are recorded only when the store shows them.</li>
        <li>We never infer installs, sales, profit, retention or search volume from ranks or ratings.</li>
      </ul>

      <h2>Labels</h2>
      <ul>
        <li><span className="badge observed">Observed</span> fetched from a public store source by this tool, with source URL and UTC timestamp.</li>
        <li><span className="badge user">User-supplied</span> imported from your files or entered manually; stored separately from observed data and never merged with it.</li>
        <li><span className="badge modeled">Modeled</span> output of the Monetization Scenarios calculator from your own inputs.</li>
        <li><span className="badge demo">Demo · fictional</span> invented records in demo mode only, kept in a separate database.</li>
      </ul>

      <h2>Charts, gaps and movement</h2>
      <ul>
        <li>Each daily snapshot stores requested depth, observed depth and status (complete / partial / failed / empty).</li>
        <li>A listing is “absent” on a day only if a comparable chart was actually fetched that day and it was not within the observed depth. If no chart was fetched, the day is a gap — charts and exports leave it blank.</li>
        <li>Movement compares the same scope only. 7-day and 30-day movers compare to a snapshot exactly that many days earlier (up to 2 days earlier if that day is missing). If none exists, the view says “insufficient history” instead of inventing a delta.</li>
        <li><strong>First observed</strong> = first time this tool saw the listing in that chart. <strong>Re-entry</strong> = seen before, absent from the previous snapshot, back now. <strong>New to chart</strong> is not the same as <strong>newly released</strong> (store release date).</li>
        <li>Filtering an all-category chart by genre produces a <strong>filtered subset</strong>, labeled as such. Category charts come only from sources that publish them.</li>
        <li>Re-running ingestion on the same day does not duplicate snapshots: a complete snapshot for a scope/day is kept; a failed or partial one can be replaced by a better fetch. A failure never overwrites good data.</li>
      </ul>

      <h2>Markets and categories</h2>
      <ul>
        <li>Every request is country-scoped. A US result is never shown as India data. Markets are configured in the registry (Data &amp; settings); defaults are US and India, with UK and Japan ready to enable after validation.</li>
        <li>Original store categories are kept. A many-to-one, editable mapping groups them into unified categories for cross-store filtering. “All” means all tracked categories.</li>
      </ul>

      <h2>Cross-store products</h2>
      <p>App Store and Google Play listings are linked only by you, or by accepting a reviewable suggestion that shows its evidence (title match plus a matching publisher or identifier prefix). Similar names alone never link apps, and ratings or ranks are never combined across stores.</p>

      <h2>Sources and coverage</h2>
      <ul>
        {(meta?.providers ?? []).map((p: any) => (
          <li key={p.id}>
            <strong>{p.name}</strong> <span className="badge">{p.status}</span> — {p.intendedUse}
            <ul className="small">{p.limitations.map((x: string) => <li key={x}>{x}</li>)}</ul>
          </li>
        ))}
      </ul>
      <p>Broad coverage means: daily charts from verified sources, plus search, direct URL tracking and imports for the long tail. It does not mean every listing in every store is indexed.</p>

      <h2>Ads and social evidence</h2>
      <p>The evidence library stores references (links, your notes, and metrics exactly as a source displays them, with label and scope). Paid ads, organic posts and unverified sponsorships are kept distinct. Appearing in an ad library, even repeatedly, says nothing about spend, sales, ROAS or conversion.</p>

      <h2>Privacy</h2>
      <p>The local app binds to 127.0.0.1. Private notes, evidence, teardowns, keyword data and first-party analytics stay in your local SQLite file and are excluded from the public static export, which contains only redistributable store fields.</p>
    </div>
  );
}
