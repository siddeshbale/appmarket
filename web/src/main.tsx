import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter, NavLink, Route, Routes } from 'react-router-dom';
import { ToastProvider, useAsync } from './components/ui';
import { api, PUBLIC_MODE } from './lib/api';
import Compare from './pages/Compare';
import DataSettings from './pages/DataSettings';
import Discover from './pages/Discover';
import Evidence from './pages/Evidence';
import KeywordLab from './pages/KeywordLab';
import ListingPage from './pages/Listing';
import Methodology from './pages/Methodology';
import PublisherPage from './pages/Publisher';
import ResearchBrief from './pages/ResearchBrief';
import Scenarios from './pages/Scenarios';
import Track from './pages/Track';
import Watchlists from './pages/Watchlists';
import { MetaCtx } from './lib/meta';
import './styles.css';

const NAV: [string, string, boolean][] = [
  ['Research', '', true],
  ['/', 'Discover', false],
  ['/track', 'Track an app', false],
  ['/compare', 'Compare', false],
  ['/watchlists', 'Watchlists & alerts', false],
  ['Evidence', '', true],
  ['/evidence', 'Ads, creators & onboarding', false],
  ['/keywords', 'Keyword Lab', false],
  ['/brief', 'Research brief', false],
  ['/scenarios', 'Monetization scenarios', false],
  ['System', '', true],
  ['/data', 'Data & settings', false],
  ['/methodology', 'Methodology', false],
];

function Shell() {
  const meta = useAsync(() => api.get('/api/meta'), []);
  const m = meta.data;
  const unread = useAsync(() => (PUBLIC_MODE ? Promise.resolve([]) : api.get<any[]>('/api/alerts?unread=1')), []);
  return (
    <MetaCtx.Provider value={m}>
      <a href="#main" className="skip">
        Skip to content
      </a>
      <div className="app">
        <aside className="sidebar">
          <div className="brand">
            <svg width="22" height="22" viewBox="0 0 32 32" aria-hidden>
              <circle cx="16" cy="16" r="14" fill="var(--accent)" />
              <path d="M16 16 L26 8" stroke="white" strokeWidth="3" />
              <circle cx="16" cy="16" r="3" fill="white" />
            </svg>
            App Market Radar
          </div>
          <nav className="nav" aria-label="Main">
            {NAV.map(([to, label, group]) =>
              group ? (
                <div className="group" key={to}>
                  {to}
                </div>
              ) : (
                <NavLink key={to} to={to} end={to === '/'}>
                  {label}
                  {to === '/watchlists' && unread.data && unread.data.length > 0 ? <span className="badge warn" style={{ marginLeft: 6 }}>{unread.data.length}</span> : null}
                </NavLink>
              ),
            )}
          </nav>
          <p className="small muted" style={{ padding: '14px 10px' }}>
            {PUBLIC_MODE ? 'Public read-only build' : 'Local mode · loopback only'}
            <br />
            Independent tool — not affiliated with Apple, Google, or any analytics vendor.
          </p>
        </aside>
        <main className="main" id="main">
          {m?.mode === 'demo' && (
            <div className="banner demo" role="note">
              <strong>DEMO MODE — every app, publisher, rank and metric shown is fictional.</strong> Demo data lives in a separate database and is never mixed with live data.{!PUBLIC_MODE && <> Run <code>npm start</code> for live mode.</>}
            </div>
          )}
          {PUBLIC_MODE && (
            <div className="banner public" role="note">
              <strong>Public read-only snapshot</strong> generated {m?.generatedAt?.slice(0, 16).replace('T', ' ')} UTC. Contains only redistributable store fields; no private notes, evidence or first-party data. Watchlists here are stored only in this browser.
            </div>
          )}
          {meta.error && <div className="banner bad">Cannot reach the local API: {meta.error.message}. Is the server running (npm start)?</div>}
          <Routes>
            <Route path="/" element={<Discover />} />
            <Route path="/track" element={<Track />} />
            <Route path="/listing/:id" element={<ListingPage />} />
            <Route path="/publisher/:id" element={<PublisherPage />} />
            <Route path="/compare" element={<Compare />} />
            <Route path="/watchlists" element={<Watchlists />} />
            <Route path="/evidence" element={<Evidence />} />
            <Route path="/keywords" element={<KeywordLab />} />
            <Route path="/brief" element={<ResearchBrief />} />
            <Route path="/scenarios" element={<Scenarios />} />
            <Route path="/data" element={<DataSettings />} />
            <Route path="/methodology" element={<Methodology />} />
            <Route path="*" element={<div className="state"><strong>Page not found</strong></div>} />
          </Routes>
        </main>
      </div>
    </MetaCtx.Provider>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <HashRouter>
      <ToastProvider>
        <Shell />
      </ToastProvider>
    </HashRouter>
  </StrictMode>,
);
