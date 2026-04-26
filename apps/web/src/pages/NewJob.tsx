import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client.js';
import type { DatasetSubsetInput, TrainJob, TrainJobInput, PreprocessOptions, LoRAProfile, ModelType, TrainParams } from '../types/job.js';
import { useT } from '../i18n/LangContext.js';

const MODEL_TYPES: ModelType[] = ['sd1x', 'sdxl', 'flux', 'anima'];
const MAX_PREVIEW_IMAGES = 12;
const IMAGE_FILE_RE = /\.(png|jpe?g|webp|bmp|gif)$/i;
const PREPARE_BUCKETS_UNSUPPORTED = new Set<ModelType>(['flux', 'anima']);
const HISTORY_LIMIT = 8;
const SETTINGS_EXPORT_KIND = 'kohya-job-settings';
const SETTINGS_EXPORT_VERSION = 1;
const MODEL_REQUIRED_OVERRIDE_FIELDS: Partial<Record<ModelType, Array<keyof TrainParams>>> = {
  flux: ['clipL', 't5xxl', 'ae'],
  anima: ['qwen3', 'vae'],
};

const INITIAL_TRAIN_INPUT: TrainJobInput = {
  name: '',
  modelType: 'sdxl',
  baseModelPath: '',
  datasetDir: '',
  outputDir: '',
  outputName: '',
  datasetSubsets: [],
  sdScriptsDir: '',
  triggerWord: '',
  repeatCount: 10,
  profileId: 'sdxl-standard',
};

const INITIAL_PREPROCESS_OPTIONS: Partial<PreprocessOptions> = {
  runWd14Tagger: true,
  wd14Threshold: 0.35,
  wd14BatchSize: 8,
  runCaptioning: 'none',
  runPrepareBuckets: false,
  skipPreprocessing: false,
};

type SerializedJobSettings = {
  kind: typeof SETTINGS_EXPORT_KIND;
  version: typeof SETTINGS_EXPORT_VERSION;
  savedAt: string;
  input: TrainJobInput;
  preprocessOptions: Partial<PreprocessOptions>;
};

type PreviewItem = {
  name: string;
  url: string;
};

type EditableDatasetSubset = DatasetSubsetInput & {
  id: string;
  previews: PreviewItem[];
  previewTotal: number;
};

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
  sectionActions: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginBottom: 14 },
  historyActions: { display: 'flex', gap: 8, flexWrap: 'wrap' },
  actionBtn: { background: '#243b53', color: '#dbeafe', border: '1px solid #34567a', borderRadius: 6, padding: '6px 12px', cursor: 'pointer', fontSize: 12, fontWeight: 600 },
  removeBtn: { background: '#3b1a1a', color: '#fecaca', border: '1px solid #7f1d1d', borderRadius: 6, padding: '6px 12px', cursor: 'pointer', fontSize: 12, fontWeight: 600 },
  historyList: { display: 'flex', flexDirection: 'column', gap: 10 },
  historyCard: { background: '#141414', border: '1px solid #252525', borderRadius: 8, padding: '12px 14px', display: 'flex', justifyContent: 'space-between', gap: 16, alignItems: 'center' },
  historyTitle: { fontSize: 13, fontWeight: 700, color: '#e5e7eb', marginBottom: 4 },
  historyMeta: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 6, fontSize: 12, color: '#777', minWidth: 360 },
  historyButtons: { display: 'flex', gap: 8, flexShrink: 0 },
  subsetCard: { background: '#141414', border: '1px solid #252525', borderRadius: 8, padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 12 },
  subsetHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 },
  subsetTitle: { fontSize: 13, fontWeight: 700, color: '#e5e7eb' },
  previewWrap: { background: '#141414', border: '1px solid #242424', borderRadius: 8, padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 10 },
  previewTitle: { fontSize: 12, color: '#a78bfa', textTransform: 'uppercase', letterSpacing: 1, fontWeight: 700 },
  previewMeta: { fontSize: 12, color: '#777' },
  previewGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(92px, 1fr))', gap: 10 },
  previewCard: { display: 'flex', flexDirection: 'column', gap: 6 },
  previewImage: { width: '100%', aspectRatio: '1 / 1', objectFit: 'cover', borderRadius: 6, border: '1px solid #333', background: '#0f0f0f' },
  previewName: { fontSize: 11, color: '#999', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
  hint: { fontSize: 12, color: '#666', lineHeight: 1.6 },
  submitBtn: { background: '#7c3aed', color: '#fff', border: 'none', borderRadius: 8, padding: '10px 24px', cursor: 'pointer', fontSize: 14, fontWeight: 600 },
  error: { background: '#3b0404', border: '1px solid #7f1d1d', borderRadius: 6, padding: '10px 14px', color: '#fca5a5', fontSize: 13 },
};

function createSubsetId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `subset-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function createEditableDatasetSubset(source?: DatasetSubsetInput): EditableDatasetSubset {
  return {
    id: createSubsetId(),
    imageDir: source?.imageDir?.trim() ?? '',
    triggerWord: source?.triggerWord?.trim() ?? '',
    repeatCount: Math.max(1, Number(source?.repeatCount) || 10),
    previews: [],
    previewTotal: 0,
  };
}

function createEmptyDatasetSubset(): EditableDatasetSubset {
  return createEditableDatasetSubset();
}

function revokePreviewUrls(previews: PreviewItem[]): void {
  previews.forEach(item => URL.revokeObjectURL(item.url));
}

function sanitizeDatasetSubsets(subsets: EditableDatasetSubset[]): DatasetSubsetInput[] {
  return subsets
    .map(subset => ({
      imageDir: subset.imageDir.trim(),
      triggerWord: subset.triggerWord?.trim() || undefined,
      repeatCount: Math.max(1, Number(subset.repeatCount) || 10),
    }))
    .filter(subset => subset.imageDir);
}

function sanitizeOverrides(overrides: Partial<TrainParams> | undefined): Partial<TrainParams> | undefined {
  if (!overrides) return undefined;

  const normalized = Object.entries(overrides).reduce<Partial<TrainParams>>((acc, [key, value]) => {
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (!trimmed) return acc;
      return { ...acc, [key]: trimmed };
    }
    if (value === undefined || value === null) return acc;
    return { ...acc, [key]: value };
  }, {});

  return Object.keys(normalized).length ? normalized : undefined;
}

function buildPreviewItems(files: FileList | null): { previews: PreviewItem[]; total: number } {
  const imageFiles = Array.from(files ?? []).filter(file => {
    const hasImageMime = file.type.startsWith('image/');
    return hasImageMime || IMAGE_FILE_RE.test(file.name);
  });

  return {
    total: imageFiles.length,
    previews: imageFiles.slice(0, MAX_PREVIEW_IMAGES).map(file => ({
      name: file.name,
      url: URL.createObjectURL(file),
    })),
  };
}

function buildEditableDatasetSubsets(input: TrainJobInput): EditableDatasetSubset[] {
  const subsets = input.datasetSubsets?.length
    ? input.datasetSubsets
    : input.datasetDir.trim()
      ? [{ imageDir: input.datasetDir, triggerWord: input.triggerWord, repeatCount: input.repeatCount }]
      : [];

  return subsets.length ? subsets.map(subset => createEditableDatasetSubset(subset)) : [createEmptyDatasetSubset()];
}

function normalizeDraftInput(input: TrainJobInput): TrainJobInput {
  const normalizedDatasetSubsets = (input.datasetSubsets ?? [])
    .map(subset => ({
      imageDir: subset.imageDir?.trim() ?? '',
      triggerWord: subset.triggerWord?.trim() || undefined,
      repeatCount: Math.max(1, Number(subset.repeatCount) || 10),
    }))
    .filter(subset => subset.imageDir);

  const primarySubset = normalizedDatasetSubsets[0];

  return {
    ...INITIAL_TRAIN_INPUT,
    ...input,
    name: input.name?.trim() ?? '',
    modelType: input.modelType,
    baseModelPath: input.baseModelPath?.trim() ?? '',
    datasetDir: primarySubset?.imageDir ?? input.datasetDir?.trim() ?? '',
    datasetSubsets: normalizedDatasetSubsets,
    outputDir: input.outputDir?.trim() ?? '',
    outputName: input.outputName?.trim() ?? '',
    sdScriptsDir: input.sdScriptsDir?.trim() ?? '',
    triggerWord: primarySubset?.triggerWord ?? input.triggerWord?.trim() ?? '',
    repeatCount: primarySubset?.repeatCount ?? Math.max(1, Number(input.repeatCount) || 10),
    profileId: input.profileId?.trim() ?? '',
    overrides: sanitizeOverrides(input.overrides),
  };
}

function isTrainJobInput(value: unknown): value is TrainJobInput {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate['modelType'] === 'string'
    && typeof candidate['name'] === 'string'
    && typeof candidate['baseModelPath'] === 'string'
    && typeof candidate['datasetDir'] === 'string'
    && typeof candidate['outputDir'] === 'string'
    && typeof candidate['outputName'] === 'string';
}

function parseSerializedSettings(rawText: string): SerializedJobSettings {
  const parsed = JSON.parse(rawText) as Partial<SerializedJobSettings>;
  if (!parsed || parsed.kind !== SETTINGS_EXPORT_KIND || parsed.version !== SETTINGS_EXPORT_VERSION || !isTrainJobInput(parsed.input)) {
    throw new Error('Invalid settings file');
  }

  return {
    kind: SETTINGS_EXPORT_KIND,
    version: SETTINGS_EXPORT_VERSION,
    savedAt: typeof parsed.savedAt === 'string' ? parsed.savedAt : new Date().toISOString(),
    input: parsed.input,
    preprocessOptions: typeof parsed.preprocessOptions === 'object' && parsed.preprocessOptions
      ? parsed.preprocessOptions
      : {},
  };
}

function getNativeFilePath(file: File): string | null {
  const nativePath = (file as File & { path?: string }).path;
  return typeof nativePath === 'string' && nativePath.trim() ? nativePath : null;
}

export default function NewJob() {
  const navigate = useNavigate();
  const { t } = useT();
  const [profiles, setProfiles] = useState<LoRAProfile[]>([]);
  const [jobs, setJobs] = useState<TrainJob[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [datasetSubsets, setDatasetSubsets] = useState<EditableDatasetSubset[]>([createEmptyDatasetSubset()]);
  const datasetSubsetsRef = useRef(datasetSubsets);
  const importRef = useRef<HTMLInputElement | null>(null);

  const [input, setInput] = useState<TrainJobInput>(INITIAL_TRAIN_INPUT);

  const [preproc, setPreproc] = useState<Partial<PreprocessOptions>>(INITIAL_PREPROCESS_OPTIONS);
  const prepareBucketsSupported = !PREPARE_BUCKETS_UNSUPPORTED.has(input.modelType);
  const historyJobs = jobs
    .filter(job => job.modelType === input.modelType && job.status !== 'running')
    .slice(0, HISTORY_LIMIT);

  useEffect(() => {
    api.listProfiles().then(ps => {
      setProfiles(ps);
      const def = ps.find(p => p.id === `${input.modelType}-standard`);
      if (def) setInput(i => ({ ...i, profileId: def.id }));
    }).catch(console.error);
    api.listJobs().then(setJobs).catch(console.error);
  }, []);

  useEffect(() => {
    datasetSubsetsRef.current = datasetSubsets;
  }, [datasetSubsets]);

  useEffect(() => () => {
    datasetSubsetsRef.current.forEach(subset => revokePreviewUrls(subset.previews));
  }, []);

  useEffect(() => {
    if (!prepareBucketsSupported && preproc.runPrepareBuckets) {
      setPreproc(current => ({ ...current, runPrepareBuckets: false }));
    }
  }, [prepareBucketsSupported, preproc.runPrepareBuckets]);

  // Sync default profile when model type changes
  const handleModelChange = (mt: ModelType) => {
    const def = profiles.find(p => p.id === `${mt}-standard`);
    setInput(i => ({ ...i, modelType: mt, profileId: def?.id ?? '' }));
  };

  const replaceDatasetSubsets = (nextSubsets: EditableDatasetSubset[]) => {
    datasetSubsetsRef.current.forEach(subset => revokePreviewUrls(subset.previews));
    setDatasetSubsets(nextSubsets);
  };

  const applyDraft = (nextInput: TrainJobInput, nextPreproc?: Partial<PreprocessOptions>) => {
    setError('');
    const normalizedInput = normalizeDraftInput(nextInput);
    setInput(normalizedInput);
    setPreproc({ ...INITIAL_PREPROCESS_OPTIONS, ...(nextPreproc ?? {}) });
    replaceDatasetSubsets(buildEditableDatasetSubsets(normalizedInput));
  };

  const exportSettings = () => {
    const normalizedSubsets = sanitizeDatasetSubsets(datasetSubsets);
    const primarySubset = normalizedSubsets[0];
    const payload: SerializedJobSettings = {
      kind: SETTINGS_EXPORT_KIND,
      version: SETTINGS_EXPORT_VERSION,
      savedAt: new Date().toISOString(),
      input: {
        ...normalizeDraftInput(input),
        datasetDir: primarySubset?.imageDir ?? input.datasetDir,
        datasetSubsets: normalizedSubsets,
        triggerWord: primarySubset?.triggerWord,
        repeatCount: primarySubset?.repeatCount,
        overrides: sanitizeOverrides(input.overrides),
      },
      preprocessOptions: { ...INITIAL_PREPROCESS_OPTIONS, ...preproc },
    };

    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    const safeName = (input.name || `${input.modelType}-settings`).replace(/[^a-z0-9-_]+/gi, '-');
    anchor.href = url;
    anchor.download = `${safeName}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const importSettings = async (file: File | null) => {
    if (!file) return;

    try {
      const parsed = parseSerializedSettings(await file.text());
      applyDraft(parsed.input, parsed.preprocessOptions);
    } catch {
      setError(t.errImportSettings);
    }
  };

  const applyHistoryJob = (job: TrainJob) => {
    applyDraft(job.input, job.preprocessOptions);
  };

  const deleteHistoryJob = async (job: TrainJob) => {
    if (!confirm(t.historyDeleteConfirm(job.name))) return;

    setError('');
    try {
      await api.deleteJob(job.id);
      setJobs(current => current.filter(item => item.id !== job.id));
    } catch (err) {
      setError(String(err));
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    const normalizedSubsets = sanitizeDatasetSubsets(datasetSubsets);
    const normalizedOverrides = sanitizeOverrides(input.overrides);
    if (!normalizedSubsets.length) {
      setError(t.errRequired(t.fieldDatasetDir));
      return;
    }

    const required: (keyof TrainJobInput)[] = ['name', 'baseModelPath', 'outputDir', 'outputName'];
    for (const k of required) {
      if (!input[k]) { setError(t.errRequired(k)); return; }
    }

    for (const field of MODEL_REQUIRED_OVERRIDE_FIELDS[input.modelType] ?? []) {
      const value = normalizedOverrides?.[field];
      if (typeof value !== 'string' || !value) {
        setError(t.errRequired(getOverrideLabel(field)));
        return;
      }
    }

    if (!prepareBucketsSupported && preproc.runPrepareBuckets) {
      setError(t.prepareBucketsUnsupported(input.modelType.toUpperCase()));
      return;
    }

    const primarySubset = normalizedSubsets[0];
    const payload: TrainJobInput = {
      ...input,
      datasetDir: primarySubset.imageDir,
      datasetSubsets: normalizedSubsets,
      triggerWord: primarySubset.triggerWord,
      repeatCount: primarySubset.repeatCount,
      overrides: normalizedOverrides,
    };

    setLoading(true);
    try {
      const job = await api.createJob(payload, preproc);
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

  const getOverrideValue = (field: keyof TrainParams): string => {
    const value = input.overrides?.[field];
    return typeof value === 'string' ? value : '';
  };

  const setOverrideValue = (field: keyof TrainParams, value: string) => {
    setInput(current => ({
      ...current,
      overrides: {
        ...(current.overrides ?? {}),
        [field]: value,
      },
    }));
  };

  const getOverrideLabel = (field: keyof TrainParams): string => {
    switch (field) {
      case 'clipL': return t.fieldFluxClipL;
      case 't5xxl': return t.fieldFluxT5xxl;
      case 'ae': return t.fieldFluxAe;
      case 'qwen3': return t.fieldAnimaQwen3;
      case 'vae': return t.fieldAnimaVae;
      case 't5TokenizerPath': return t.fieldAnimaT5TokenizerPath;
      case 'llmAdapterPath': return t.fieldAnimaLlmAdapterPath;
      default: return String(field);
    }
  };

  const updateDatasetSubset = (
    subsetId: string,
    updater: (subset: EditableDatasetSubset) => EditableDatasetSubset,
  ) => {
    setDatasetSubsets(prev => prev.map(subset => (
      subset.id === subsetId ? updater(subset) : subset
    )));
  };

  const openFolderPicker = (onSelected: (fullPath: string, files: FileList | null) => void) => {
    const el = document.createElement('input');
    el.type = 'file';
    // @ts-ignore — webkitdirectory is non-standard but works in Electron/Chrome
    el.webkitdirectory = true;
    el.onchange = () => {
      const f = el.files?.[0];
      if (f) {
        const fullPath = getNativeFilePath(f);
        if (!fullPath) {
          setError(t.errLocalPathAccess);
          return;
        }
        setError('');
        onSelected(fullPath, el.files ?? null);
      }
    };
    el.click();
  };

  const browseFolder = (field: keyof TrainJobInput) => {
    openFolderPicker(fullPath => {
      setInput(i => ({ ...i, [field]: fullPath }));
    });
  };

  const browseFile = (field: keyof TrainJobInput) => {
    const el = document.createElement('input');
    el.type = 'file';
    el.accept = '.safetensors,.ckpt,.pt';
    el.onchange = () => {
      const f = el.files?.[0];
      if (f) {
        const fullPath = getNativeFilePath(f);
        if (!fullPath) {
          setError(t.errLocalPathAccess);
          return;
        }
        setError('');
        setInput(i => ({ ...i, [field]: fullPath }));
      }
    };
    el.click();
  };

  const browseOverrideFile = (field: keyof TrainParams) => {
    const el = document.createElement('input');
    el.type = 'file';
    el.accept = '.safetensors,.ckpt,.pt,.bin';
    el.onchange = () => {
      const f = el.files?.[0];
      if (f) {
        const fullPath = getNativeFilePath(f);
        if (!fullPath) {
          setError(t.errLocalPathAccess);
          return;
        }
        setError('');
        setOverrideValue(field, fullPath);
      }
    };
    el.click();
  };

  const browseOverrideFolder = (field: keyof TrainParams) => {
    openFolderPicker(fullPath => {
      setOverrideValue(field, fullPath);
    });
  };

  const browseSubsetFolder = (subsetId: string) => {
    openFolderPicker((fullPath, files) => {
      const { previews, total } = buildPreviewItems(files);
      updateDatasetSubset(subsetId, subset => {
        revokePreviewUrls(subset.previews);
        return { ...subset, imageDir: fullPath, previews, previewTotal: total };
      });
    });
  };

  const handleSubsetPathChange = (subsetId: string, value: string) => {
    updateDatasetSubset(subsetId, subset => {
      revokePreviewUrls(subset.previews);
      return { ...subset, imageDir: value, previews: [], previewTotal: 0 };
    });
  };

  const addDatasetSubset = () => {
    setDatasetSubsets(prev => [...prev, createEmptyDatasetSubset()]);
  };

  const removeDatasetSubset = (subsetId: string) => {
    setDatasetSubsets(prev => {
      if (prev.length === 1) return prev;
      const removing = prev.find(subset => subset.id === subsetId);
      if (removing) revokePreviewUrls(removing.previews);
      return prev.filter(subset => subset.id !== subsetId);
    });
  };

  const filteredProfiles = profiles.filter(p => p.id.startsWith(input.modelType));

  return (
    <div>
      <h1 style={S.h1}>{t.newJobTitle}</h1>
      <form style={S.form} onSubmit={handleSubmit}>
        <div style={S.section}>
          <div style={S.sectionActions}>
            <div style={S.sectionTitle}>{t.sectionHistory}</div>
            <div style={S.historyActions}>
              <button type="button" style={S.actionBtn} onClick={exportSettings}>{t.exportSettings}</button>
              <button type="button" style={S.actionBtn} onClick={() => importRef.current?.click()}>{t.importSettings}</button>
              <input
                ref={importRef}
                type="file"
                accept="application/json,.json"
                style={{ display: 'none' }}
                onChange={async e => {
                  await importSettings(e.target.files?.[0] ?? null);
                  e.currentTarget.value = '';
                }}
              />
            </div>
          </div>
          {historyJobs.length === 0 ? (
            <div style={S.hint}>{t.historyEmpty}</div>
          ) : (
            <div style={S.historyList}>
              {historyJobs.map(job => (
                <div key={job.id} style={S.historyCard}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={S.historyTitle}>{job.name || t.historyImported}</div>
                    <div style={S.historyMeta}>
                      <span>{t.historyLastUsed}: {new Date(job.createdAt).toLocaleString()}</span>
                      <span>{t.historyOutputName}: {job.input.outputName || '—'}</span>
                      <span>{t.historyStatus}: {job.status}</span>
                    </div>
                  </div>
                  <div style={S.historyButtons}>
                    <button type="button" style={S.actionBtn} onClick={() => applyHistoryJob(job)}>{t.historyApply}</button>
                    <button type="button" style={S.removeBtn} onClick={() => deleteHistoryJob(job)}>{t.historyDelete}</button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

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
            <div style={S.row}>
              <label style={S.label}>{t.fieldKohyaSsDir}</label>
              <div style={S.inputRow}>
                <input style={S.input} placeholder={t.fieldKohyaSsDirPlaceholder} {...inp('sdScriptsDir')} />
                <button type="button" style={S.browseBtn} onClick={() => browseFolder('sdScriptsDir')}>{t.browseFolder}</button>
              </div>
            </div>
            <label style={S.checkRow}>
              <input type="checkbox" checked={!!preproc.skipPreprocessing}
                onChange={e => setPreproc(p => ({ ...p, skipPreprocessing: e.target.checked }))} />
              {t.skipPreprocessing}
            </label>
          </div>
        </div>

        {/* ── Dataset subsets ── */}
        <div style={S.section}>
          <div style={S.sectionActions}>
            <div style={S.sectionTitle}>{t.sectionDatasets}</div>
            <button type="button" style={S.actionBtn} onClick={addDatasetSubset}>{t.addDatasetSubset}</button>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {datasetSubsets.map((subset, index) => (
              <div key={subset.id} style={S.subsetCard}>
                <div style={S.subsetHeader}>
                  <div style={S.subsetTitle}>{t.datasetSubsetTitle(index + 1)}</div>
                  <button
                    type="button"
                    style={S.removeBtn}
                    onClick={() => removeDatasetSubset(subset.id)}
                    disabled={datasetSubsets.length === 1}
                  >
                    {t.removeDatasetSubset}
                  </button>
                </div>
                <div style={S.row}>
                  <label style={S.label}>{t.fieldDatasetDir}</label>
                  <div style={S.inputRow}>
                    <input
                      style={S.input}
                      placeholder={t.fieldDatasetDir}
                      value={subset.imageDir}
                      onChange={e => handleSubsetPathChange(subset.id, e.target.value)}
                    />
                    <button type="button" style={S.browseBtn} onClick={() => browseSubsetFolder(subset.id)}>{t.browseFolder}</button>
                  </div>
                </div>
                <div style={S.grid2}>
                  <div style={S.row}>
                    <label style={S.label}>{t.fieldTriggerWord}</label>
                    <input
                      style={S.input}
                      placeholder={t.fieldTriggerWordPlaceholder}
                      value={subset.triggerWord ?? ''}
                      onChange={e => updateDatasetSubset(subset.id, current => ({ ...current, triggerWord: e.target.value }))}
                    />
                  </div>
                  <div style={S.row}>
                    <label style={S.label}>{t.fieldRepeatCount}</label>
                    <input
                      style={S.input}
                      type="number"
                      min="1"
                      value={subset.repeatCount ?? 10}
                      onChange={e => updateDatasetSubset(subset.id, current => ({
                        ...current,
                        repeatCount: Math.max(1, Number(e.target.value) || 1),
                      }))}
                    />
                  </div>
                </div>
                <div style={S.previewWrap}>
                  <div style={S.previewTitle}>{t.datasetPreviewTitle}</div>
                  {subset.previews.length > 0 ? (
                    <>
                      <div style={S.previewMeta}>{t.datasetPreviewCount(subset.previews.length, subset.previewTotal)}</div>
                      <div style={S.previewGrid}>
                        {subset.previews.map(item => (
                          <div key={item.url} style={S.previewCard}>
                            <img src={item.url} alt={item.name} style={S.previewImage} />
                            <div style={S.previewName} title={item.name}>{item.name}</div>
                          </div>
                        ))}
                      </div>
                      {subset.previewTotal > subset.previews.length && (
                        <div style={S.hint}>{t.datasetPreviewMore(subset.previewTotal - subset.previews.length)}</div>
                      )}
                    </>
                  ) : (
                    <div style={S.hint}>{t.datasetPreviewEmpty}</div>
                  )}
                </div>
              </div>
            ))}
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
            {input.modelType === 'flux' && (
              <>
                <div style={S.row}>
                  <label style={S.label}>{t.fieldFluxClipL}</label>
                  <div style={S.inputRow}>
                    <input
                      style={S.input}
                      placeholder={t.fieldFluxClipL}
                      value={getOverrideValue('clipL')}
                      onChange={e => setOverrideValue('clipL', e.target.value)}
                    />
                    <button type="button" style={S.browseBtn} onClick={() => browseOverrideFile('clipL')}>{t.browseFile}</button>
                  </div>
                </div>
                <div style={S.row}>
                  <label style={S.label}>{t.fieldFluxT5xxl}</label>
                  <div style={S.inputRow}>
                    <input
                      style={S.input}
                      placeholder={t.fieldFluxT5xxl}
                      value={getOverrideValue('t5xxl')}
                      onChange={e => setOverrideValue('t5xxl', e.target.value)}
                    />
                    <button type="button" style={S.browseBtn} onClick={() => browseOverrideFile('t5xxl')}>{t.browseFile}</button>
                  </div>
                </div>
                <div style={S.row}>
                  <label style={S.label}>{t.fieldFluxAe}</label>
                  <div style={S.inputRow}>
                    <input
                      style={S.input}
                      placeholder={t.fieldFluxAe}
                      value={getOverrideValue('ae')}
                      onChange={e => setOverrideValue('ae', e.target.value)}
                    />
                    <button type="button" style={S.browseBtn} onClick={() => browseOverrideFile('ae')}>{t.browseFile}</button>
                  </div>
                </div>
              </>
            )}
            {input.modelType === 'anima' && (
              <>
                <div style={S.row}>
                  <label style={S.label}>{t.fieldAnimaQwen3}</label>
                  <div style={S.inputRow}>
                    <input
                      style={S.input}
                      placeholder={t.fieldAnimaQwen3}
                      value={getOverrideValue('qwen3')}
                      onChange={e => setOverrideValue('qwen3', e.target.value)}
                    />
                    <button type="button" style={S.browseBtn} onClick={() => browseOverrideFile('qwen3')}>{t.browseFile}</button>
                  </div>
                </div>
                <div style={S.row}>
                  <label style={S.label}>{t.fieldAnimaVae}</label>
                  <div style={S.inputRow}>
                    <input
                      style={S.input}
                      placeholder={t.fieldAnimaVae}
                      value={getOverrideValue('vae')}
                      onChange={e => setOverrideValue('vae', e.target.value)}
                    />
                    <button type="button" style={S.browseBtn} onClick={() => browseOverrideFile('vae')}>{t.browseFile}</button>
                  </div>
                </div>
                <div style={S.row}>
                  <label style={S.label}>{t.fieldAnimaT5TokenizerPath}</label>
                  <div style={S.inputRow}>
                    <input
                      style={S.input}
                      placeholder={t.fieldAnimaT5TokenizerPath}
                      value={getOverrideValue('t5TokenizerPath')}
                      onChange={e => setOverrideValue('t5TokenizerPath', e.target.value)}
                    />
                    <button type="button" style={S.browseBtn} onClick={() => browseOverrideFolder('t5TokenizerPath')}>{t.browseFolder}</button>
                  </div>
                </div>
                <div style={S.row}>
                  <label style={S.label}>{t.fieldAnimaLlmAdapterPath}</label>
                  <div style={S.inputRow}>
                    <input
                      style={S.input}
                      placeholder={t.fieldAnimaLlmAdapterPath}
                      value={getOverrideValue('llmAdapterPath')}
                      onChange={e => setOverrideValue('llmAdapterPath', e.target.value)}
                    />
                    <button type="button" style={S.browseBtn} onClick={() => browseOverrideFile('llmAdapterPath')}>{t.browseFile}</button>
                  </div>
                </div>
              </>
            )}
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
            <label style={{ ...S.checkRow, ...(prepareBucketsSupported ? null : { opacity: 0.5 }) }}>
              <input
                type="checkbox"
                checked={prepareBucketsSupported && !!preproc.runPrepareBuckets}
                disabled={!prepareBucketsSupported}
                onChange={e => setPreproc(p => ({ ...p, runPrepareBuckets: e.target.checked }))}
              />
              {t.prepareBuckets}
            </label>
            {!prepareBucketsSupported && (
              <div style={S.hint}>{t.prepareBucketsUnsupported(input.modelType.toUpperCase())}</div>
            )}
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
