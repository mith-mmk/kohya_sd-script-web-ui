import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client.js';
import type { TrainJob, JobStatus } from '../types/job.js';
import { useT } from '../i18n/LangContext.js';

const STATUS_COLOR: Record<JobStatus, string> = {
  queued: 'var(--faint)', running: '#15803d', paused: '#b7791f', failed: 'var(--danger-text)',
  completed: '#818cf8', resumable: '#fb923c',
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const S: Record<string, any> = {
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 },
  h1: { fontSize: 20, fontWeight: 700 },
  newBtn: { background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 6, padding: '7px 16px', cursor: 'pointer', fontSize: 13 },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: 13 },
  th: { textAlign: 'left', padding: '8px 12px', borderBottom: '1px solid var(--border)', color: 'var(--muted)' },
  td: { padding: '10px 12px', borderBottom: '1px solid var(--border)' },
  badge: (status: JobStatus): React.CSSProperties => ({
    background: STATUS_COLOR[status] + '22', color: STATUS_COLOR[status],
    borderRadius: 4, padding: '2px 8px', fontSize: 12, fontWeight: 600,
  }),
  link: { color: 'var(--accent-soft)', textDecoration: 'none' },
  empty: { textAlign: 'center', padding: 60, color: 'var(--faint)' },
};

export default function JobList() {
  const [jobs, setJobs] = useState<TrainJob[]>([]);
  const { t } = useT();

  useEffect(() => {
    api.listJobs().then(setJobs).catch(console.error);
    const t = setInterval(() => api.listJobs().then(setJobs).catch(console.error), 3000);
    return () => clearInterval(t);
  }, []);

  return (
    <div>
      <div style={S.header}>
        <h1 style={S.h1}>{t.jobListTitle}</h1>
        <Link to="/new"><button style={S.newBtn}>{t.newJobBtn}</button></Link>
      </div>
      {jobs.length === 0 ? (
        <div style={S.empty}>{t.noJobs} <Link style={S.link} to="/new">{t.noJobsLink}</Link></div>
      ) : (
        <table style={S.table}>
          <thead>
            <tr>
              {[t.colName, t.colModel, t.colStatus, t.colPhase, t.colCreated].map(h => (
                <th key={h} style={S.th}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {jobs.map(j => (
              <tr key={j.id}>
                <td style={S.td}><Link style={S.link} to={`/jobs/${j.id}`}>{j.name}</Link></td>
                <td style={S.td}>{j.modelType.toUpperCase()}</td>
                <td style={S.td}><span style={S.badge(j.status)}>{j.status}</span></td>
                <td style={S.td}>{j.currentPhase}</td>
                <td style={S.td}>{new Date(j.createdAt).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
