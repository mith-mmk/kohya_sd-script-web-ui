import { Routes, Route, Link } from 'react-router-dom';
import JobList from './pages/JobList.js';
import JobDetail from './pages/JobDetail.js';
import NewJob from './pages/NewJob.js';
import { useT, type Lang } from './i18n/LangContext.js';

const S: Record<string, React.CSSProperties> = {
  layout: { display: 'flex', height: '100vh', overflow: 'hidden' },
  sidebar: { width: 220, background: '#181818', borderRight: '1px solid #333', display: 'flex', flexDirection: 'column', padding: '16px 12px' },
  logo: { fontSize: 14, fontWeight: 700, color: '#a78bfa', marginBottom: 24, letterSpacing: 1 },
  nav: { display: 'flex', flexDirection: 'column', gap: 6 },
  link: { color: '#ccc', textDecoration: 'none', padding: '6px 10px', borderRadius: 6, fontSize: 13 },
  main: { flex: 1, overflow: 'auto', padding: 24 },
  langRow: { marginTop: 'auto', display: 'flex', alignItems: 'center', gap: 6, padding: '8px 10px', borderTop: '1px solid #2a2a2a' },
  langLabel: { fontSize: 11, color: '#555' },
  langSelect: { fontSize: 12, background: '#0f0f0f', color: '#888', border: '1px solid #333', borderRadius: 4, padding: '3px 6px', cursor: 'pointer', flex: 1 },
};

export default function App() {
  const { t, lang, setLang } = useT();
  return (
    <div style={S.layout}>
      <aside style={S.sidebar}>
        <div style={S.logo}>{t.appTitle}</div>
        <nav style={S.nav}>
          <Link style={S.link} to="/">{t.navJobs}</Link>
          <Link style={S.link} to="/new">{t.navNewJob}</Link>
        </nav>
        <div style={S.langRow}>
          <span style={S.langLabel}>{t.langLabel}</span>
          <select style={S.langSelect} value={lang}
            onChange={e => setLang(e.target.value as Lang)}>
            <option value="ja">日本語</option>
            <option value="en">English</option>
          </select>
        </div>
      </aside>
      <main style={S.main}>
        <Routes>
          <Route path="/" element={<JobList />} />
          <Route path="/new" element={<NewJob />} />
          <Route path="/jobs/:id" element={<JobDetail />} />
        </Routes>
      </main>
    </div>
  );
}
