import { useEffect, useMemo, useState } from 'react';
import { api } from '../api/client.js';
import { useT } from '../i18n/LangContext.js';
import type { JobStatus, PromptListResponse, PromptSubsetEntry } from '../types/job.js';

interface Props {
  jobId: string;
  jobStatus: JobStatus;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const S: Record<string, any> = {
  shell: { display: 'grid', gridTemplateColumns: '320px minmax(0, 1fr)', gap: 16 },
  panel: { background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 8, padding: 16 },
  editorGrid: { display: 'grid', gridTemplateColumns: 'minmax(240px, 360px) minmax(0, 1fr)', gap: 16, alignItems: 'start' },
  previewBox: { background: 'var(--panel-muted)', border: '1px solid var(--border)', borderRadius: 8, padding: 12 },
  previewImage: { width: '100%', maxHeight: 420, objectFit: 'contain', borderRadius: 6, background: '#111', display: 'block' },
  sectionTitle: { fontSize: 11, color: 'var(--faint)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 12 },
  note: { color: 'var(--muted)', fontSize: 13, lineHeight: 1.7 },
  path: { color: 'var(--accent-soft)', fontFamily: 'monospace', fontSize: 12, wordBreak: 'break-all' },
  select: { width: '100%', background: 'var(--panel-muted)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 6, padding: '8px 10px', marginBottom: 12 },
  fileList: { display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 420, overflowY: 'auto' },
  fileButton: (active: boolean): React.CSSProperties => ({
    width: '100%', textAlign: 'left', border: `1px solid ${active ? 'var(--accent)' : 'var(--border)'}`, background: active ? 'color-mix(in srgb, var(--accent) 14%, var(--panel))' : 'var(--panel-muted)',
    color: 'var(--text)', borderRadius: 8, padding: '10px 12px', cursor: 'pointer',
  }),
  fileName: { fontSize: 13, fontWeight: 600, marginBottom: 4 },
  fileMeta: { color: 'var(--faint)', fontSize: 11 },
  textarea: { width: '100%', minHeight: 360, resize: 'vertical', background: 'var(--panel-muted)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 8, padding: 14, fontSize: 13, lineHeight: 1.6, fontFamily: 'ui-monospace, SFMono-Regular, Consolas, monospace' },
  toolbar: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, gap: 12 },
  saveButton: (disabled: boolean): React.CSSProperties => ({
    background: disabled ? 'var(--faint)' : 'var(--accent)', color: '#fff', border: 'none', borderRadius: 6, padding: '8px 14px', cursor: disabled ? 'not-allowed' : 'pointer', fontWeight: 600,
  }),
  status: { color: 'var(--muted)', fontSize: 12 },
  error: { marginTop: 12, background: 'var(--danger-bg)', border: '1px solid var(--danger-border)', color: 'var(--danger-text)', borderRadius: 6, padding: '10px 12px', fontSize: 12 },
};

function formatDate(value: string): string {
  return new Date(value).toLocaleString();
}

export default function TagEditor({ jobId, jobStatus }: Props) {
  const { t } = useT();
  const [promptData, setPromptData] = useState<PromptListResponse | null>(null);
  const [selectedSubsetKey, setSelectedSubsetKey] = useState('');
  const [selectedPath, setSelectedPath] = useState('');
  const [content, setContent] = useState('');
  const [savedContent, setSavedContent] = useState('');
  const [loadingList, setLoadingList] = useState(true);
  const [loadingContent, setLoadingContent] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');

  useEffect(() => {
    let active = true;
    setLoadingList(true);
    setError('');
    api.listJobPrompts(jobId)
      .then(result => {
        if (!active) return;
        setPromptData(result);
      })
      .catch(err => {
        if (!active) return;
        setError(String(err));
      })
      .finally(() => {
        if (active) setLoadingList(false);
      });
    return () => { active = false; };
  }, [jobId]);

  const subsets = promptData?.subsets ?? [];
  const selectedSubset = useMemo<PromptSubsetEntry | null>(() => {
    return subsets.find(subset => subset.workKey === selectedSubsetKey) ?? subsets.find(subset => subset.items.length > 0) ?? subsets[0] ?? null;
  }, [selectedSubsetKey, subsets]);

  useEffect(() => {
    if (!selectedSubset) {
      setSelectedSubsetKey('');
      return;
    }
    if (selectedSubset.workKey !== selectedSubsetKey) {
      setSelectedSubsetKey(selectedSubset.workKey);
    }
  }, [selectedSubset, selectedSubsetKey]);

  useEffect(() => {
    if (!selectedSubset) {
      setSelectedPath('');
      return;
    }
    if (selectedSubset.items.some(item => item.relativePath === selectedPath)) return;
    setSelectedPath(selectedSubset.items[0]?.relativePath ?? '');
  }, [selectedPath, selectedSubset]);

  useEffect(() => {
    if (!selectedSubset || !selectedPath) {
      setContent('');
      setSavedContent('');
      return;
    }

    let active = true;
    setLoadingContent(true);
    setError('');
    setStatus('');
    api.getJobPromptContent(jobId, selectedSubset.workKey, selectedPath)
      .then(result => {
        if (!active) return;
        setContent(result.content);
        setSavedContent(result.content);
      })
      .catch(err => {
        if (!active) return;
        setError(String(err));
      })
      .finally(() => {
        if (active) setLoadingContent(false);
      });

    return () => { active = false; };
  }, [jobId, selectedPath, selectedSubset]);

  const isDirty = content !== savedContent;
  const selectedItem = selectedSubset?.items.find(item => item.relativePath === selectedPath) ?? null;
  const selectedImageUrl = selectedSubset && selectedItem?.imageRelativePath
    ? api.getJobPromptImageUrl(jobId, selectedSubset.workKey, selectedItem.imageRelativePath)
    : '';

  const savePrompt = async () => {
    if (!selectedSubset || !selectedPath || !isDirty || saving || jobStatus === 'running') return;
    setSaving(true);
    setError('');
    setStatus('');
    try {
      await api.saveJobPromptContent(jobId, selectedSubset.workKey, selectedPath, content);
      setSavedContent(content);
      setStatus(t.tagEditorSaved);
    } catch (err) {
      setError(String(err));
    } finally {
      setSaving(false);
    }
  };

  const saveDisabled = !selectedSubset || !selectedPath || !isDirty || saving || loadingContent || jobStatus === 'running';

  if (loadingList) {
    return <div style={S.panel}>{t.loading}</div>;
  }

  if (!promptData) {
    return <div style={S.error}>{error || t.tagEditorLoadFailed}</div>;
  }

  const hasPromptFiles = subsets.some(subset => subset.items.length > 0);

  return (
    <div style={S.shell}>
      <div style={S.panel}>
        <div style={S.sectionTitle}>{t.tagEditorDatasetDir}</div>
        {selectedSubset ? <div style={S.path}>{selectedSubset.effectiveDir}</div> : <div style={S.path}>{t.tagEditorNotSet}</div>}
        <div style={{ ...S.note, marginTop: 12 }}>{t.tagEditorDesc}</div>
        <div style={{ ...S.note, marginTop: 10 }}>{t.tagEditorHint}</div>

        {subsets.length > 1 && (
          <>
            <div style={{ ...S.sectionTitle, marginTop: 20 }}>{t.tagEditorSubsetLabel}</div>
            <select style={S.select} value={selectedSubset?.workKey ?? ''} onChange={event => setSelectedSubsetKey(event.target.value)}>
              {subsets.map(subset => (
                <option key={subset.workKey} value={subset.workKey}>{subset.label}</option>
              ))}
            </select>
          </>
        )}

        <div style={S.sectionTitle}>{t.tagEditorPromptFiles}</div>
        {!selectedSubset?.available && <div style={S.note}>{t.tagEditorUnavailable}</div>}
        {selectedSubset?.available && selectedSubset.items.length === 0 && <div style={S.note}>{t.tagEditorEmpty}</div>}
        <div style={S.fileList}>
          {selectedSubset?.items.map(item => (
            <button key={item.id} style={S.fileButton(item.relativePath === selectedPath)} onClick={() => setSelectedPath(item.relativePath)}>
              <div style={S.fileName}>{item.baseName}</div>
              <div style={S.fileMeta}>{item.relativePath}</div>
              <div style={S.fileMeta}>{formatDate(item.updatedAt)}</div>
            </button>
          ))}
        </div>
      </div>

      <div style={S.panel}>
        <div style={S.toolbar}>
          <div>
            <div style={S.sectionTitle}>{t.tabTags}</div>
            <div style={S.status}>{selectedItem ? selectedItem.relativePath : t.tagEditorSelectFile}</div>
          </div>
          <button style={S.saveButton(saveDisabled)} disabled={saveDisabled} onClick={savePrompt}>
            {saving ? t.tagEditorSaving : t.tagEditorSave}
          </button>
        </div>

        {!hasPromptFiles && <div style={S.note}>{t.tagEditorEmpty}</div>}
        {hasPromptFiles && (
          <div style={S.editorGrid}>
            <div style={S.previewBox}>
              <div style={S.sectionTitle}>Preview</div>
              {selectedImageUrl ? (
                <img
                  key={selectedImageUrl}
                  src={selectedImageUrl}
                  alt={selectedItem?.baseName ?? 'preview'}
                  style={S.previewImage}
                />
              ) : (
                <div style={S.note}>対応する画像が見つかりません。</div>
              )}
            </div>
            <textarea
              style={S.textarea}
              value={content}
              onChange={event => setContent(event.target.value)}
              disabled={loadingContent}
              placeholder={t.tagEditorSelectFile}
            />
          </div>
        )}

        <div style={{ ...S.status, marginTop: 10 }}>
          {jobStatus === 'running' ? t.tagEditorRunning : status || (isDirty ? t.tagEditorDirty : '')}
        </div>
        {error && <div style={S.error}>{error}</div>}
      </div>
    </div>
  );
}
