import { Routes, Route, Link } from 'react-router-dom';
import JobList from './pages/JobList.js';
import JobDetail from './pages/JobDetail.js';
import NewJob from './pages/NewJob.js';
import { useT, type Lang } from './i18n/LangContext.js';
import { useTheme, type ThemeMode } from './theme.js';

const S: Record<string, React.CSSProperties> = {
  layout: { display: 'flex', height: '100vh', overflow: 'hidden' },
  sidebar: { width: 220, background: 'var(--panel)', borderRight: '1px solid var(--border)', display: 'flex', flexDirection: 'column', padding: '16px 12px' },
  logo: { fontSize: 14, fontWeight: 700, color: 'var(--accent-soft)', marginBottom: 24, letterSpacing: 1 },
  nav: { display: 'flex', flexDirection: 'column', gap: 6 },
  link: { color: 'var(--text)', textDecoration: 'none', padding: '6px 10px', borderRadius: 6, fontSize: 13 },
  main: { flex: 1, overflow: 'auto', padding: 24 },
  controlStack: { marginTop: 'auto', display: 'flex', flexDirection: 'column', gap: 8, padding: '8px 10px', borderTop: '1px solid var(--border)' },
  controlRow: { display: 'flex', alignItems: 'center', gap: 6 },
  langLabel: { fontSize: 11, color: 'var(--faint)', minWidth: 42 },
  langSelect: { fontSize: 12, background: 'var(--panel-muted)', color: 'var(--muted)', border: '1px solid var(--border)', borderRadius: 4, padding: '3px 6px', cursor: 'pointer', flex: 1 },
};

export default function App() {
  const { t, lang, setLang } = useT();
  const { theme, setTheme } = useTheme();
  return (
    <div style={S.layout}>
      <aside style={S.sidebar}>
        <div style={S.logo}>{t.appTitle}</div>
        <nav style={S.nav}>
          <Link style={S.link} to="/">{t.navJobs}</Link>
          <Link style={S.link} to="/new">{t.navNewJob}</Link>
        </nav>
        <div style={S.controlStack}>
          <div style={S.controlRow}>
            <span style={S.langLabel}>{t.langLabel}</span>
            <select style={S.langSelect} value={lang}
              onChange={e => setLang(e.target.value as Lang)}>
              <option value="ja">日本語</option>
              <option value="en">English</option>
            </select>
          </div>
          <div style={S.controlRow}>
            <span style={S.langLabel}>Theme</span>
            <select style={S.langSelect} value={theme}
              onChange={e => setTheme(e.target.value as ThemeMode)}>
              <option value="dark">Dark</option>
              <option value="light">Light</option>
              <option value="system">System</option>
            </select>
          </div>
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
