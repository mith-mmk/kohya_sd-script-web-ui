import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client.js';
import type { TrainJobInput, PreprocessOptions, LoRAProfile, ModelType } from '../types/job.js';
import { useT } from '../i18n/LangContext.js';

const MODEL_TYPES: ModelType[] = ['sd1x', 'sdxl', 'flux', 'anima'];

const S: Record<string, React.CSSProperties> = {
  h1: { fontSize: 20, fontWeight: 700, marginBottom: 24 },
  form: { maxWidth: 680, display: 'flex', flexDirection: 'column', gap: 20 },
  section: { background: '#1a1a1a', borderRadius: 8, padding: '16px 20px', border: '1px solid #2a2a2a' },
  sectionTitle: { fontSize: 13, fontWeight: 700, color: '#a78bfa', marginBottom: 14, textTransform: 'uppercase', letterSpacing: 1 },
  row: { display: 'flex', flexDirection: 'column', gap: 4 },
  label: { fontSize: 12, color: '#888' },
  input: { background: '#0f0f0f', border: '1px solid #333', borderRadius: 6, color: '#e0e0e0', padding: '7px 10px', fontSize: 13, flex: 1 },
  inputRow: { display: 'flex', gap: 6 },
  browseBtn: { background: '#2a2a2a', color: '#aaa', border: '1px solid #444', borderRadius: 6, padding: '7px 12px', cursor: 'pointer', fontSize: 12, whiteSpace: 'nowrap' },
  select: { background: '#0f0f0f', border: '1px solid #333', borderRadius: 6, color: '#e0e0e0', padding: '7px 10px', fontSize: 13, width: '100%' },
  grid2: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 },
  summary: { fontSize: 12, color: '#a78bfa', cursor: 'pointer', userSelect: 'none' },
  checkRow: { display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 },
  submitBtn: { background: '#7c3aed', color: '#fff', border: 'none', borderRadius: 8, padding: '10px 24px', cursor: 'pointer', fontSize: 14, fontWeight: 600 },
  error: { background: '#3b0404', border: '1px solid #7f1d1d', borderRadius: 6, padding: '10px 14px', color: '#fca5a5', fontSize: 13 },
};

export default function NewJob() {
  const navigate = useNavigate();
  const { t } = useT();
  const [profiles, setProfiles] = useState<LoRAProfile[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const [input, setInput] = useState<TrainJobInput>({
    name: '', modelType: 'sdxl', baseModelPath: '', datasetDir: '',
    outputDir: '', outputName: '', profileId: 'sdxl-standard',
  });

  const [preproc, setPreproc] = useState<Partial<PreprocessOptions>>({
    runWd14Tagger: true, wd14Threshold: 0.35, wd14BatchSize: 8,
    runCaptioning: 'none', runPrepareBuckets: false, skipPreprocessing: false,
  });

  useEffect(() => {
    api.listProfiles().then(ps => {
      setProfiles(ps);
      const def = ps.find(p => p.id === `${input.modelType}-standard`);
      if (def) setInput(i => ({ ...i, profileId: def.id }));
    }).catch(console.error);
  }, []);

  // Sync default profile when model type changes
  const handleModelChange = (mt: ModelType) => {
    const def = profiles.find(p => p.id === `${mt}-standard`);
    setInput(i => ({ ...i, modelType: mt, profileId: def?.id ?? '' }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    const required: (keyof TrainJobInput)[] = ['name', 'baseModelPath', 'datasetDir', 'outputDir', 'outputName'];
    for (const k of required) {
      if (!input[k]) { setError(t.errRequired(k)); return; }
    }
    setLoading(true);
    try {
      const job = await api.createJob(input, preproc);
      await api.startJob(job.id);
      navigate(`/jobs/${job.id}`);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  };

  const inp = (field: keyof TrainJobInput) => ({
    value: (input[field] ?? '') as string,
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setInput(i => ({ ...i, [field]: e.target.value })),
  });

  /** Browse for a folder or file using Electron's dialog via hidden <input> */
  const browseFolder = (field: keyof TrainJobInput) => {
    const el = document.createElement('input');
    el.type = 'file';
    // @ts-ignore — webkitdirectory is non-standard but works in Electron/Chrome
    el.webkitdirectory = true;
    el.onchange = () => {
      const f = el.files?.[0];
      if (f) {
        // In Electron, webkitRelativePath gives us the full path via file.path
        const fullPath = (f as File & { path?: string }).path ?? f.webkitRelativePath.split('/')[0];
        setInput(i => ({ ...i, [field]: fullPath }));
      }
    };
    el.click();
  };

  const browseFile = (field: keyof TrainJobInput) => {
    const el = document.createElement('input');
    el.type = 'file';
    el.accept = '.safetensors,.ckpt,.pt';
    el.onchange = () => {
      const f = el.files?.[0];
      if (f) {
        const fullPath = (f as File & { path?: string }).path ?? f.name;
        setInput(i => ({ ...i, [field]: fullPath }));
      }
    };
    el.click();
  };

  const filteredProfiles = profiles.filter(p => p.id.startsWith(input.modelType));

  return (
    <div>
      <h1 style={S.h1}>{t.newJobTitle}</h1>
      <form style={S.form} onSubmit={handleSubmit}>
        {/* ── Basic info ── */}
        <div style={S.section}>
          <div style={S.sectionTitle}>{t.sectionBasic}</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={S.row}>
              <label style={S.label}>{t.fieldJobName}</label>
              <input style={S.input} placeholder={t.fieldJobNamePlaceholder} {...inp('name')} />
            </div>
            <div style={S.grid2}>
              <div style={S.row}>
                <label style={S.label}>{t.fieldModelType}</label>
                <select style={S.select} value={input.modelType}
                  onChange={e => handleModelChange(e.target.value as ModelType)}>
                  {MODEL_TYPES.map(m => <option key={m} value={m}>{m.toUpperCase()}</option>)}
                </select>
              </div>
              <div style={S.row}>
                <label style={S.label}>{t.fieldProfile}</label>
                <select style={S.select} {...inp('profileId')}>
                  <option value="">{t.fieldProfileCustom}</option>
                  {filteredProfiles.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </div>
            </div>
            <label style={S.checkRow}>
              <input type="checkbox" checked={!!preproc.skipPreprocessing}
                onChange={e => setPreproc(p => ({ ...p, skipPreprocessing: e.target.checked }))} />
              {t.skipPreprocessing}
            </label>
          </div>
        </div>

        {/* ── Paths ── */}
        <div style={S.section}>
          <div style={S.sectionTitle}>{t.sectionPaths}</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {/* Base model — file picker */}
            <div style={S.row}>
              <label style={S.label}>{t.fieldBaseModelPath}</label>
              <div style={S.inputRow}>
                <input style={S.input} placeholder={t.fieldBaseModelPath} {...inp('baseModelPath')} />
                <button type="button" style={S.browseBtn} onClick={() => browseFile('baseModelPath')}>{t.browseFile}</button>
              </div>
            </div>
            {/* Dataset folder */}
            <div style={S.row}>
              <label style={S.label}>{t.fieldDatasetDir}</label>
              <div style={S.inputRow}>
                <input style={S.input} placeholder={t.fieldDatasetDir} {...inp('datasetDir')} />
                <button type="button" style={S.browseBtn} onClick={() => browseFolder('datasetDir')}>{t.browseFolder}</button>
              </div>
            </div>
            {/* Output folder */}
            <div style={S.row}>
              <label style={S.label}>{t.fieldOutputDir}</label>
              <div style={S.inputRow}>
                <input style={S.input} placeholder={t.fieldOutputDir} {...inp('outputDir')} />
                <button type="button" style={S.browseBtn} onClick={() => browseFolder('outputDir')}>{t.browseFolder}</button>
              </div>
            </div>
            {/* Output name — no browse */}
            <div style={S.row}>
              <label style={S.label}>{t.fieldOutputName}</label>
              <input style={S.input} placeholder={t.fieldOutputNamePlaceholder} {...inp('outputName')} />
            </div>
          </div>
        </div>

        {/* ── Preprocessing ── */}
        <details style={{ ...S.section, ...(preproc.skipPreprocessing ? { opacity: 0.4, pointerEvents: 'none' } : {}) }}>
          <summary style={S.summary}>▶ {t.sectionPreproc}</summary>
          <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
            <label style={S.checkRow}>
              <input type="checkbox" checked={!!preproc.runWd14Tagger}
                onChange={e => setPreproc(p => ({ ...p, runWd14Tagger: e.target.checked }))} />
              {t.wd14Tagger}
            </label>
            {preproc.runWd14Tagger && (
              <div style={S.grid2}>
                <div style={S.row}>
                  <label style={S.label}>{t.wd14Threshold}</label>
                  <input style={S.input} type="number" step="0.01" min="0" max="1"
                    value={preproc.wd14Threshold ?? 0.35}
                    onChange={e => setPreproc(p => ({ ...p, wd14Threshold: Number(e.target.value) }))} />
                </div>
                <div style={S.row}>
                  <label style={S.label}>{t.wd14BatchSize}</label>
                  <input style={S.input} type="number" min="1"
                    value={preproc.wd14BatchSize ?? 8}
                    onChange={e => setPreproc(p => ({ ...p, wd14BatchSize: Number(e.target.value) }))} />
                </div>
              </div>
            )}
            <div style={S.row}>
              <label style={S.label}>{t.captioning}</label>
              <select style={S.select} value={preproc.runCaptioning ?? 'none'}
                onChange={e => setPreproc(p => ({ ...p, runCaptioning: e.target.value as 'none' | 'blip' | 'git' }))}>
                <option value="none">{t.captionNone}</option>
                <option value="blip">{t.captionBlip}</option>
                <option value="git">{t.captionGit}</option>
              </select>
            </div>
            <label style={S.checkRow}>
              <input type="checkbox" checked={!!preproc.runPrepareBuckets}
                onChange={e => setPreproc(p => ({ ...p, runPrepareBuckets: e.target.checked }))} />
              {t.prepareBuckets}
            </label>
          </div>
        </details>

        {error && <div style={S.error}>{error}</div>}
        <div>
          <button style={S.submitBtn} type="submit" disabled={loading}>
            {loading ? t.submitting : t.submitBtn}
          </button>
        </div>
      </form>
    </div>
  );
}
