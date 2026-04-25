import { useEffect, useState, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api, subscribeJobLogs } from '../api/client.js';
import Console from '../components/Console.js';
import TagEditor from '../components/TagEditor.js';
import type { TrainJob, LogEvent, JobStatus } from '../types/job.js';
import { useT } from '../i18n/LangContext.js';

const STATUS_COLOR: Record<JobStatus, string> = {
  queued: '#888', running: '#4ade80', paused: '#fbbf24', failed: '#f87171',
  completed: '#818cf8', resumable: '#fb923c',
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const S: Record<string, any> = {
  back: { color: '#666', textDecoration: 'none', fontSize: 13, marginBottom: 16, display: 'inline-block' },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 },
  title: { fontSize: 20, fontWeight: 700 },
  meta: { fontSize: 12, color: '#666', marginTop: 4 },
  badge: (s: JobStatus): React.CSSProperties => ({
    background: STATUS_COLOR[s] + '22', color: STATUS_COLOR[s],
    borderRadius: 4, padding: '3px 10px', fontSize: 13, fontWeight: 600,
  }),
  actions: { display: 'flex', gap: 10 },
  btn: (color: string): React.CSSProperties => ({
    background: color, color: '#fff', border: 'none', borderRadius: 6,
    padding: '7px 16px', cursor: 'pointer', fontSize: 13, fontWeight: 600,
  }),
  grid: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 20 },
  card: { background: '#1a1a1a', borderRadius: 8, padding: '14px 18px', border: '1px solid #2a2a2a' },
  cardTitle: { fontSize: 11, color: '#666', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10 },
  kv: { display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 6 },
  key: { color: '#888' },
  val: { color: '#e0e0e0', textAlign: 'right', maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  tabs: { display: 'flex', gap: 2, marginBottom: 16 },
  tab: (active: boolean): React.CSSProperties => ({
    padding: '6px 16px', fontSize: 13, borderRadius: '6px 6px 0 0', cursor: 'pointer', border: 'none',
    background: active ? '#2a2a2a' : '#1a1a1a', color: active ? '#a78bfa' : '#666', fontWeight: active ? 600 : 400,
  }),
  error: { background: '#3b0404', border: '1px solid #7f1d1d', borderRadius: 6, padding: '10px 14px', color: '#fca5a5', fontSize: 13, marginBottom: 16 },
};

type Tab = 'console' | 'params' | 'tags';

export default function JobDetail() {
  const { id } = useParams<{ id: string }>();
  const [job, setJob] = useState<TrainJob | null>(null);
  const [logs, setLogs] = useState<LogEvent[]>([]);
  const [tab, setTab] = useState<Tab>('console');
  const [actionErr, setActionErr] = useState('');

  const refreshJob = useCallback(() => {
    if (!id) return;
    api.getJob(id).then(setJob).catch(console.error);
  }, [id]);

  useEffect(() => {
    if (!id) return;
    refreshJob();
    // Load historical logs
    api.getLogs(id).then(setLogs).catch(console.error);
    // Subscribe to live logs
    const unsub = subscribeJobLogs(id, event => {
      setLogs(prev => [...prev, event]);
      // Refresh job status on exit/system events
      if (event.type === 'exit' || event.type === 'system') refreshJob();
    });
    // Poll job status
    const t = setInterval(refreshJob, 4000);
    return () => { unsub(); clearInterval(t); };
  }, [id, refreshJob]);

  const act = async (action: () => Promise<unknown>) => {
    setActionErr('');
    try { await action(); refreshJob(); }
    catch (err) { setActionErr(String(err)); }
  };

  const { t } = useT();
  if (!job) return <div style={{ color: '#666', padding: 40 }}>{t.loading}</div>;

  const datasetDirs = job.input.datasetSubsets?.map(subset => subset.imageDir).filter(Boolean)
    ?? (job.input.datasetDir ? [job.input.datasetDir] : []);
  const datasetSummary = datasetDirs.length > 1
    ? `${datasetDirs[0]} (+${datasetDirs.length - 1})`
    : (datasetDirs[0] ?? '—');

  return (
    <div>
      <Link style={S.back} to="/">{t.backToList}</Link>
      <div style={S.header}>
        <div>
          <h1 style={S.title}>{job.name}</h1>
          <div style={S.meta}>{job.modelType.toUpperCase()} · {job.id}</div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 10 }}>
          <span style={S.badge(job.status)}>{job.status}</span>
          <div style={S.actions}>
            {job.status === 'queued' && (
              <button style={S.btn('#16a34a')} onClick={() => act(() => api.startJob(job.id))}>{t.btnStart}</button>
            )}
            {job.status === 'running' && (
              <button style={S.btn('#b45309')} onClick={() => act(() => api.stopJob(job.id))}>{t.btnStop}</button>
            )}
            {(job.status === 'failed' || job.status === 'resumable') && (
              <button style={S.btn('#7c3aed')} onClick={() => act(() => api.resumeJob(job.id))}>
                {job.retryCount > 0 ? t.btnResumeTier(job.retryCount + 1) : t.btnResume}
              </button>
            )}
          </div>
        </div>
      </div>

      {actionErr && <div style={S.error}>{actionErr}</div>}
      {job.errorMessage && job.status !== 'resumable' && (
        <div style={S.error}>Error: {job.errorMessage}</div>
      )}

      {/* Info grid */}
      <div style={S.grid}>
        <div style={S.card}>
          <div style={S.cardTitle}>{t.cardPaths}</div>
          {[
            [t.labelBaseModel, job.input.baseModelPath],
            [t.labelDataset, datasetSummary],
            [t.labelOutput, job.input.outputDir],
            [t.labelName, job.input.outputName],
          ].map(([k, v]) => (
            <div key={k} style={S.kv}><span style={S.key}>{k}</span><span style={S.val} title={v}>{v}</span></div>
          ))}
        </div>
        <div style={S.card}>
          <div style={S.cardTitle}>{t.cardProgress}</div>
          {[
            [t.labelPhase, job.currentPhase],
            [t.labelRetry, job.retryCount],
            [t.labelStarted, job.startedAt ? new Date(job.startedAt).toLocaleString() : '—'],
            [t.labelCompleted, job.completedAt ? new Date(job.completedAt).toLocaleString() : '—'],
          ].map(([k, v]) => (
            <div key={k} style={S.kv}><span style={S.key}>{k}</span><span style={S.val}>{v}</span></div>
          ))}
        </div>
      </div>

      {/* Tabs */}
      <div style={S.tabs}>
        {(['console', 'params', 'tags'] as Tab[]).map(tabKey => (
          <button key={tabKey} style={S.tab(tab === tabKey)} onClick={() => setTab(tabKey)}>
            {tabKey === 'console' ? t.tabConsole : tabKey === 'params' ? t.tabParams : t.tabTags}
          </button>
        ))}
      </div>

      {tab === 'console' && <Console events={logs} />}
      {tab === 'params' && <ParamsView params={job.params} />}
      {tab === 'tags' && <TagEditor datasetDirs={datasetDirs} />}
    </div>
  );
}

function ParamsView({ params }: { params: TrainJob['params'] }) {
  return (
    <div style={{ background: '#1a1a1a', borderRadius: 8, padding: '16px 20px', border: '1px solid #2a2a2a' }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 24px' }}>
        {Object.entries(params).map(([k, v]) => (
          <div key={k} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, padding: '4px 0', borderBottom: '1px solid #222' }}>
            <span style={{ color: '#888' }}>{k}</span>
            <span style={{ color: '#e0e0e0' }}>{String(v)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
