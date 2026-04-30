import { useEffect, useState, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api, subscribeJobLogs } from '../api/client.js';
import Console from '../components/Console.js';
import TagEditor from '../components/TagEditor.js';
import type { TrainJob, LogEvent, JobStatus, TrainParams } from '../types/job.js';
import { useT } from '../i18n/LangContext.js';

const STATUS_COLOR: Record<JobStatus, string> = {
  queued: 'var(--faint)', running: '#15803d', paused: '#b7791f', failed: 'var(--danger-text)',
  completed: '#818cf8', resumable: '#fb923c',
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const S: Record<string, any> = {
  back: { color: 'var(--faint)', textDecoration: 'none', fontSize: 13, marginBottom: 16, display: 'inline-block' },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 },
  title: { fontSize: 20, fontWeight: 700 },
  meta: { fontSize: 12, color: 'var(--faint)', marginTop: 4 },
  badge: (s: JobStatus): React.CSSProperties => ({
    background: STATUS_COLOR[s] + '22', color: STATUS_COLOR[s],
    borderRadius: 4, padding: '3px 10px', fontSize: 13, fontWeight: 600,
  }),
  actions: { display: 'flex', gap: 10 },
  btn: (color: string): React.CSSProperties => ({
    background: color, color: '#fff', border: 'none', borderRadius: 6,
    padding: '7px 16px', cursor: 'pointer', fontSize: 13, fontWeight: 600,
  }),
  input: { background: 'var(--panel-muted)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text)', padding: '7px 10px', fontSize: 13, width: '100%' },
  select: { background: 'var(--panel-muted)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text)', padding: '7px 10px', fontSize: 13, width: '100%' },
  grid: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 20 },
  card: { background: 'var(--panel)', borderRadius: 8, padding: '14px 18px', border: '1px solid var(--border)' },
  cardTitle: { fontSize: 11, color: 'var(--faint)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10 },
  kv: { display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 6 },
  key: { color: 'var(--muted)' },
  val: { color: 'var(--text)', textAlign: 'right', maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  tabs: { display: 'flex', gap: 2, marginBottom: 16 },
  tab: (active: boolean): React.CSSProperties => ({
    padding: '6px 16px', fontSize: 13, borderRadius: '6px 6px 0 0', cursor: 'pointer', border: 'none',
    background: active ? 'var(--panel-muted)' : 'var(--panel)', color: active ? 'var(--accent-soft)' : 'var(--faint)', fontWeight: active ? 600 : 400,
  }),
  error: { background: 'var(--danger-bg)', border: '1px solid var(--danger-border)', borderRadius: 6, padding: '10px 14px', color: 'var(--danger-text)', fontSize: 13, marginBottom: 16 },
};

type Tab = 'console' | 'params' | 'steps' | 'tags';

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
  if (!job) return <div style={{ color: 'var(--faint)', padding: 40 }}>{t.loading}</div>;

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
            {job.status === 'paused' && (
              <button style={S.btn('#16a34a')} onClick={() => act(() => api.continueJob(job.id))}>学習を続行</button>
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
        {(['console', 'params', 'steps', 'tags'] as Tab[]).map(tabKey => (
          <button key={tabKey} style={S.tab(tab === tabKey)} onClick={() => setTab(tabKey)}>
            {tabKey === 'console' ? t.tabConsole : tabKey === 'params' ? t.tabParams : tabKey === 'steps' ? 'Steps' : t.tabTags}
          </button>
        ))}
      </div>

      {tab === 'console' && <Console events={logs} />}
      {tab === 'params' && <ParamsView job={job} onSaved={setJob} />}
      {tab === 'steps' && <StepsView job={job} />}
      {tab === 'tags' && <TagEditor jobId={job.id} jobStatus={job.status} />}
    </div>
  );
}

function StepsView({ job }: { job: TrainJob }) {
  const steps = job.manifest?.steps ?? [];
  if (!steps.length) {
    return (
      <div style={S.card}>
        <div style={S.cardTitle}>Workflow steps</div>
        <div style={S.key}>No manifest has been recorded for this job.</div>
      </div>
    );
  }

  return (
    <div style={{ ...S.card, display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={S.cardTitle}>Workflow steps</div>
      {job.manifest?.resumeFromStep && (
        <div style={S.error}>Resume will start from: {job.manifest.resumeFromStep}</div>
      )}
      {steps.map(step => (
        <div key={step.id} style={{ display: 'grid', gridTemplateColumns: '180px 120px 1fr', gap: 12, alignItems: 'center', borderBottom: '1px solid var(--border)', paddingBottom: 8 }}>
          <div style={{ color: 'var(--text)', fontWeight: 600 }}>{step.name}</div>
          <div style={{ color: step.status === 'failed' ? 'var(--danger-text)' : step.status === 'completed' ? '#15803d' : 'var(--muted)' }}>{step.status}</div>
          <div style={{ color: 'var(--muted)', fontSize: 12 }}>
            {step.error ?? step.outputs.map(output => output.path).join(', ') ?? ''}
          </div>
        </div>
      ))}
    </div>
  );
}

function parseParamValue(key: keyof TrainParams, value: string, original: TrainParams[keyof TrainParams]): TrainParams[keyof TrainParams] | undefined {
  if (value.trim() === '') return undefined;
  if (typeof original === 'number') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  if (typeof original === 'boolean') return value === 'true';
  return value;
}

function ParamsView({ job, onSaved }: { job: TrainJob; onSaved: (job: TrainJob) => void }) {
  const [draft, setDraft] = useState<Record<string, string>>(() => Object.fromEntries(
    Object.entries(job.params).map(([key, value]) => [key, String(value)]),
  ));
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const editable = job.status !== 'running' && job.status !== 'completed';

  useEffect(() => {
    setDraft(Object.fromEntries(Object.entries(job.params).map(([key, value]) => [key, String(value)])));
  }, [job.params]);

  const save = async () => {
    setSaving(true);
    setMessage('');
    try {
      const params = Object.fromEntries(
        Object.entries(draft)
          .map(([key, value]) => [key, parseParamValue(key as keyof TrainParams, value, job.params[key as keyof TrainParams])])
          .filter(([, value]) => value !== undefined),
      ) as Partial<TrainParams>;
      const savedJob = await api.updateJobParams(job.id, params);
      onSaved(savedJob);
      setMessage('保存しました。');
    } catch (err) {
      setMessage(String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ background: 'var(--panel)', borderRadius: 8, padding: '16px 20px', border: '1px solid var(--border)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <div style={S.cardTitle}>Training parameters</div>
        <button style={S.btn(editable ? '#2563eb' : 'var(--faint)')} disabled={!editable || saving} onClick={save}>
          {saving ? '保存中…' : '保存'}
        </button>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 24px' }}>
        {Object.entries(job.params).map(([k, v]) => (
          <div key={k} style={{ display: 'grid', gridTemplateColumns: 'minmax(120px, 1fr) minmax(120px, 1fr)', gap: 8, alignItems: 'center', fontSize: 13, padding: '4px 0', borderBottom: '1px solid var(--border)' }}>
            <span style={{ color: 'var(--muted)' }}>{k}</span>
            {typeof v === 'boolean' ? (
              <select
                style={{ ...S.select, marginBottom: 0 }}
                disabled={!editable}
                value={draft[k] ?? String(v)}
                onChange={event => setDraft(current => ({ ...current, [k]: event.target.value }))}
              >
                <option value="true">true</option>
                <option value="false">false</option>
              </select>
            ) : (
              <input
                style={S.input}
                disabled={!editable}
                type={typeof v === 'number' ? 'number' : 'text'}
                value={draft[k] ?? String(v)}
                onChange={event => setDraft(current => ({ ...current, [k]: event.target.value }))}
              />
            )}
          </div>
        ))}
      </div>
      {message && <div style={{ ...S.meta, marginTop: 12 }}>{message}</div>}
    </div>
  );
}

