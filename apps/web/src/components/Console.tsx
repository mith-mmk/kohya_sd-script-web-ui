import { useEffect, useRef, useState } from 'react';
import type { LogEvent } from '../types/job.js';
import { useT } from '../i18n/LangContext.js';

interface Props {
  events: LogEvent[];
  autoScroll?: boolean;
}

const LEVEL_COLOR: Record<string, string> = {
  info: 'var(--text)', warn: '#b7791f', error: 'var(--danger-text)', progress: '#15803d',
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const S: Record<string, any> = {
  wrapper: { background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' },
  toolbar: { background: 'var(--panel-muted)', padding: '6px 12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border)' },
  toolbarTitle: { fontSize: 12, color: 'var(--faint)' },
  log: { height: 380, overflowY: 'auto', fontFamily: 'monospace', fontSize: 12, padding: '10px 14px', lineHeight: 1.6 },
  line: (level: string): React.CSSProperties => ({
    color: LEVEL_COLOR[level] ?? 'var(--text)',
    whiteSpace: 'pre-wrap', wordBreak: 'break-all',
  }),
  ts: { color: 'var(--faint)', marginRight: 8, fontSize: 11 },
  progress: { height: 3, background: 'var(--panel-muted)', borderRadius: 2, overflow: 'hidden', margin: '0 14px 8px' },
  progressBar: (pct: number): React.CSSProperties => ({
    height: '100%', width: `${pct * 100}%`, background: '#4ade80',
    transition: 'width 0.3s ease',
  }),
  autoScrollBtn: { fontSize: 11, background: 'none', border: '1px solid var(--border)', color: 'var(--muted)', borderRadius: 4, padding: '2px 8px', cursor: 'pointer' },
};

export default function Console({ events, autoScroll: initAutoScroll = true }: Props) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(initAutoScroll);
  const { t } = useT();

  const lastProgress = [...events].reverse().find(e => e.data?.progress !== undefined);
  const progress = lastProgress?.data?.progress ?? 0;

  useEffect(() => {
    if (autoScroll) bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [events, autoScroll]);

  const fmt = (ts: number) => new Date(ts).toLocaleTimeString(undefined, { hour12: false });

  return (
    <div style={S.wrapper}>
      <div style={S.toolbar}>
        <span style={S.toolbarTitle}>{t.consoleTitle(events.length)}</span>
        <button style={S.autoScrollBtn} onClick={() => setAutoScroll(v => !v)}>
          {autoScroll ? t.autoScrollOn : t.autoScrollOff}
        </button>
      </div>
      {progress > 0 && (
        <div style={S.progress}><div style={S.progressBar(progress)} /></div>
      )}
      <div style={S.log}>
        {events.map((e, i) => (
          <div key={i} style={S.line(e.level)}>
            <span style={S.ts}>{fmt(e.ts)}</span>
            {e.message}
            {e.data?.loss !== undefined && (
              <span style={{ color: 'var(--accent-soft)', marginLeft: 8 }}>loss={e.data.loss.toFixed(4)}</span>
            )}
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
