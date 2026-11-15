import { useState } from 'react';
import { emptyScenarioValues, runScenario, SCENARIOS, type ScenarioModel, type ScenarioRange } from '../../../shared/scenarios';
import { ModeledBadge } from '../components/ui';
import { fmtNum } from '../lib/format';

export default function Scenarios() {
  const [model, setModel] = useState<ScenarioModel>('iap_payers');
  const [currency, setCurrency] = useState('USD');
  const [values, setValues] = useState<Record<string, ScenarioRange>>(emptyScenarioValues('iap_payers'));
  const [fxRate, setFxRate] = useState<string>('');
  const [fxCurrency, setFxCurrency] = useState('');
  const def = SCENARIOS.find((s) => s.model === model)!;
  const res = runScenario({ model, currency, values, fxRate: fxRate ? Number(fxRate) : null, fxCurrency });
  const setV = (k: string, lvl: 'low' | 'base' | 'high', v: string) => setValues({ ...values, [k]: { ...values[k], [lvl]: v === '' ? null : Number(v) } });
  return (
    <div>
      <h1>Monetization scenarios <ModeledBadge /></h1>
      <p className="sub">A calculator for <strong>your own assumptions</strong>. Every input is user-supplied; every output is modeled. Nothing here is a measurement of any app, and scenarios are never shown on competitor profiles.</p>
      <div className="filters">
        <label className="f">
          Model
          <select value={model} onChange={(e) => { const m = e.target.value as ScenarioModel; setModel(m); setValues(emptyScenarioValues(m)); }}>
            {SCENARIOS.map((s) => <option key={s.model} value={s.model}>{s.title}</option>)}
          </select>
        </label>
        <label className="f">Currency<input type="text" value={currency} maxLength={3} onChange={(e) => setCurrency(e.target.value.toUpperCase())} style={{ width: 70 }} /></label>
        <label className="f" title="Only used if you provide it. Currencies are otherwise kept separate.">Optional rate: 1 {currency} =<input type="number" step="any" value={fxRate} onChange={(e) => setFxRate(e.target.value)} style={{ width: 100 }} /></label>
        <label className="f">in currency<input type="text" value={fxCurrency} maxLength={3} onChange={(e) => setFxCurrency(e.target.value.toUpperCase())} style={{ width: 70 }} /></label>
        <button onClick={() => setValues(emptyScenarioValues(model))}>Clear inputs</button>
      </div>
      <div className="grid cols-2">
        <div className="card">
          <h3 style={{ marginTop: 0 }}>Inputs <span className="badge user">User-supplied</span></h3>
          <p className="mono small">{def.formula}</p>
          <table className="data">
            <thead><tr><th>Input</th><th>Unit</th><th className="num">Low</th><th className="num">Base</th><th className="num">High</th></tr></thead>
            <tbody>
              {def.inputs.map((i) => (
                <tr key={i.key}>
                  <td>{i.label}</td>
                  <td className="small muted">{i.unit.replace('currency', currency)}</td>
                  {(['low', 'base', 'high'] as const).map((lvl) => (
                    <td key={lvl} className="num">
                      <input type="number" min={0} max={i.max} step="any" aria-label={`${i.label} ${lvl}`} value={values[i.key]?.[lvl] ?? ''} onChange={(e) => setV(i.key, lvl, e.target.value)} style={{ width: 110 }} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          <h3>Excluded from this calculation</h3>
          <ul className="small">{def.excludes.map((x) => <li key={x}>{x}</li>)}</ul>
        </div>
        <div className="card">
          <h3 style={{ marginTop: 0 }}>Outputs <ModeledBadge /></h3>
          {res.status === 'no_data' ? (
            <div className="state">
              <strong>No data — enter all inputs</strong>
              The calculator does not fill in defaults. Missing: {res.missing.slice(0, 6).join(', ')}{res.missing.length > 6 ? '…' : ''}
            </div>
          ) : (
            <>
              <table className="data">
                <thead><tr><th>Scenario</th><th className="num">Monthly gross ({res.currency})</th>{res.converted && <th className="num">({res.converted.currency} @ {res.converted.rate})</th>}</tr></thead>
                <tbody>
                  {(['low', 'base', 'high'] as const).map((lvl) => (
                    <tr key={lvl}>
                      <td>{lvl}</td>
                      <td className="num"><strong>{fmtNum(res[lvl], 2)}</strong></td>
                      {res.converted && <td className="num">{fmtNum(res.converted[lvl], 2)}</td>}
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="small muted">Gross before the exclusions listed. {res.converted ? 'Conversion uses only the rate you entered.' : 'No currency conversion applied.'}</p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
