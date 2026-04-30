import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client.js';
import type { DatasetSubsetInput, TrainJob, TrainJobInput, PreprocessOptions, LoRAProfile, ModelType, TrainParams, AdvancedSettingsProfile } from '../types/job.js';
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
  trainerType: 'lora',
  pauseBeforeTraining: true,
  modelType: 'sdxl',
  workBaseDir: '',
  baseModelPath: '',
  datasetDir: '',
  outputDir: '',
  outputName: '',
  datasetSubsets: [],
  sdScriptsDir: '',
  triggerWord: '',
  repeatCount: 10,
  profileId: 'sdxl-standard',
  advancedProfileId: 'balanced',
};

const INITIAL_PREPROCESS_OPTIONS: Partial<PreprocessOptions> = {
  normalizeImages: true,
  normalizedFormat: 'copy',
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

type NativeBridge = {
  version?: string;
  pickDirectory?: () => Promise<string | null>;
  pickFile?: (kind: 'model' | 'binary') => Promise<string | null>;
  listImagePreviews?: (dirPath: string, maxItems: number) => Promise<{
    previews: PreviewItem[];
    total: number;
  }>;
};

declare global {
  interface Window {
    __kohya__?: NativeBridge;
  }
}

type EditableDatasetSubset = DatasetSubsetInput & {
  id: string;
  previews: PreviewItem[];
  previewTotal: number;
};

type PathHistoryKey =
  | 'workBaseDir'
  | 'sdScriptsDir'
  | 'baseModelPath'
  | 'outputDir'
  | 'clipL'
  | 't5xxl'
  | 'ae'
  | 'qwen3'
  | 'vae'
  | 't5TokenizerPath'
  | 'llmAdapterPath';

const S: Record<string, React.CSSProperties> = {
  h1: { fontSize: 20, fontWeight: 700, marginBottom: 24 },
  form: { maxWidth: 680, display: 'flex', flexDirection: 'column', gap: 20 },
  section: { background: 'var(--panel)', borderRadius: 8, padding: '16px 20px', border: '1px solid var(--border)' },
  sectionTitle: { fontSize: 13, fontWeight: 700, color: 'var(--accent-soft)', marginBottom: 14, textTransform: 'uppercase', letterSpacing: 1 },
  topActions: { display: 'flex', justifyContent: 'flex-end', gap: 8, flexWrap: 'wrap' },
  row: { display: 'flex', flexDirection: 'column', gap: 4 },
  label: { fontSize: 12, color: 'var(--muted)' },
  input: { background: 'var(--panel-muted)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text)', padding: '7px 10px', fontSize: 13, flex: 1 },
  inputRow: { display: 'flex', gap: 6 },
  browseBtn: { background: 'var(--panel-muted)', color: 'var(--muted)', border: '1px solid var(--border)', borderRadius: 6, padding: '7px 12px', cursor: 'pointer', fontSize: 12, whiteSpace: 'nowrap' },
  select: { background: 'var(--panel-muted)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text)', padding: '7px 10px', fontSize: 13, width: '100%' },
  grid2: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 },
  summary: { fontSize: 12, color: 'var(--accent-soft)', cursor: 'pointer', userSelect: 'none' },
  checkRow: { display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 },
  sectionActions: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginBottom: 14 },
  historyActions: { display: 'flex', gap: 8, flexWrap: 'wrap' },
  actionBtn: { background: 'var(--accent)', color: '#fff', border: '1px solid var(--accent)', borderRadius: 6, padding: '6px 12px', cursor: 'pointer', fontSize: 12, fontWeight: 600 },
  removeBtn: { background: 'var(--danger-bg)', color: 'var(--danger-text)', border: '1px solid var(--danger-border)', borderRadius: 6, padding: '6px 12px', cursor: 'pointer', fontSize: 12, fontWeight: 600 },
  historyList: { display: 'flex', flexDirection: 'column', gap: 10 },
  historyCard: { background: 'var(--panel-muted)', border: '1px solid var(--border)', borderRadius: 8, padding: '12px 14px', display: 'flex', justifyContent: 'space-between', gap: 16, alignItems: 'center' },
  historyTitle: { fontSize: 13, fontWeight: 700, color: 'var(--text)', marginBottom: 4 },
  historyMeta: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 6, fontSize: 12, color: 'var(--faint)', minWidth: 360 },
  historyButtons: { display: 'flex', gap: 8, flexShrink: 0 },
  pathSuggestionRow: { display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 },
  pathSuggestionBtn: { background: 'var(--panel-muted)', color: 'var(--muted)', border: '1px solid var(--border)', borderRadius: 999, padding: '4px 10px', cursor: 'pointer', fontSize: 11, maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  subsetCard: { background: 'var(--panel-muted)', border: '1px solid var(--border)', borderRadius: 8, padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 12 },
  subsetHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 },
  subsetTitle: { fontSize: 13, fontWeight: 700, color: 'var(--text)' },
  previewWrap: { background: 'var(--panel-muted)', border: '1px solid var(--border)', borderRadius: 8, padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 10 },
  previewTitle: { fontSize: 12, color: 'var(--accent-soft)', textTransform: 'uppercase', letterSpacing: 1, fontWeight: 700 },
  previewMeta: { fontSize: 12, color: 'var(--faint)' },
  previewGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(92px, 1fr))', gap: 10 },
  previewCard: { display: 'flex', flexDirection: 'column', gap: 6 },
  previewImage: { width: '100%', aspectRatio: '1 / 1', objectFit: 'cover', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--panel-muted)' },
  previewName: { fontSize: 11, color: 'var(--faint)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
  hint: { fontSize: 12, color: 'var(--faint)', lineHeight: 1.6 },
  submitBtn: { background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 8, padding: '10px 24px', cursor: 'pointer', fontSize: 14, fontWeight: 600 },
  error: { background: 'var(--danger-bg)', border: '1px solid var(--danger-border)', borderRadius: 6, padding: '10px 14px', color: 'var(--danger-text)', fontSize: 13 },
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
  previews.forEach(item => {
    if (item.url.startsWith('blob:')) URL.revokeObjectURL(item.url);
  });
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

function getBrowserFolderLabel(files: FileList | null): string {
  const firstFile = Array.from(files ?? [])[0] as (File & { webkitRelativePath?: string }) | undefined;
  const relativePath = firstFile?.webkitRelativePath?.trim();
  if (relativePath) {
    const parts = relativePath.split('/').filter(Boolean);
    if (parts.length > 1) return parts[0] ?? '';
  }
  return '';
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
    pauseBeforeTraining: Boolean(input.pauseBeforeTraining),
    modelType: input.modelType,
    baseModelPath: input.baseModelPath?.trim() ?? '',
    datasetDir: primarySubset?.imageDir ?? input.datasetDir?.trim() ?? '',
    datasetSubsets: normalizedDatasetSubsets,
    outputDir: input.outputDir?.trim() ?? '',
    outputName: input.outputName?.trim() ?? '',
    workBaseDir: input.workBaseDir?.trim() ?? '',
    sdScriptsDir: input.sdScriptsDir?.trim() ?? '',
    triggerWord: primarySubset?.triggerWord ?? input.triggerWord?.trim() ?? '',
    repeatCount: primarySubset?.repeatCount ?? Math.max(1, Number(input.repeatCount) || 10),
    profileId: input.profileId?.trim() ?? '',
    advancedProfileId: input.advancedProfileId?.trim() ?? 'balanced',
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

async function pickNativeDirectory(): Promise<string | null | undefined> {
  if (!window.__kohya__?.pickDirectory) return undefined;
  return window.__kohya__.pickDirectory();
}

async function pickNativeFile(kind: 'model' | 'binary'): Promise<string | null | undefined> {
  if (!window.__kohya__?.pickFile) return undefined;
  return window.__kohya__.pickFile(kind);
}

async function loadNativePreviewItems(dirPath: string): Promise<{ previews: PreviewItem[]; total: number } | undefined> {
  if (!window.__kohya__?.listImagePreviews) return undefined;
  return window.__kohya__.listImagePreviews(dirPath, MAX_PREVIEW_IMAGES);
}

function isLikelyAbsolutePath(value: string): boolean {
  return /^[a-zA-Z]:[\\/]/.test(value) || value.startsWith('\\\\') || value.startsWith('/');
}

function collectRecentValues(values: Array<string | undefined>, limit = HISTORY_LIMIT): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const rawValue of values) {
    const value = rawValue?.trim();
    if (!value || !isLikelyAbsolutePath(value) || seen.has(value)) continue;
    seen.add(value);
    result.push(value);
    if (result.length >= limit) break;
  }

  return result;
}

function getStringTrainParam(params: Partial<TrainParams> | TrainParams | undefined, field: keyof TrainParams): string | undefined {
  if (!params) return undefined;
  const value = params[field];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function buildPathHistory(jobs: TrainJob[], modelType: ModelType): Record<PathHistoryKey, string[]> {
  const modelJobs = jobs.filter(job => job.modelType === modelType);
  const getPathFromJob = (job: TrainJob, field: keyof TrainParams): string | undefined => {
    return getStringTrainParam(job.input.overrides, field) ?? getStringTrainParam(job.params, field);
  };

  return {
    workBaseDir: collectRecentValues(jobs.map(job => job.input.workBaseDir ?? job.workDir)),
    sdScriptsDir: collectRecentValues(jobs.map(job => job.input.sdScriptsDir)),
    baseModelPath: collectRecentValues(modelJobs.map(job => job.input.baseModelPath)),
    outputDir: collectRecentValues(jobs.map(job => job.input.outputDir)),
    clipL: collectRecentValues(modelJobs.map(job => getPathFromJob(job, 'clipL'))),
    t5xxl: collectRecentValues(modelJobs.map(job => getPathFromJob(job, 't5xxl'))),
    ae: collectRecentValues(modelJobs.map(job => getPathFromJob(job, 'ae'))),
    qwen3: collectRecentValues(modelJobs.map(job => getPathFromJob(job, 'qwen3'))),
    vae: collectRecentValues(modelJobs.map(job => getPathFromJob(job, 'vae'))),
    t5TokenizerPath: collectRecentValues(modelJobs.map(job => getPathFromJob(job, 't5TokenizerPath'))),
    llmAdapterPath: collectRecentValues(modelJobs.map(job => getPathFromJob(job, 'llmAdapterPath'))),
  };
}

export default function NewJob() {
  const navigate = useNavigate();
  const { t } = useT();
  const [profiles, setProfiles] = useState<LoRAProfile[]>([]);
  const [advancedProfiles, setAdvancedProfiles] = useState<AdvancedSettingsProfile[]>([]);
  const [jobs, setJobs] = useState<TrainJob[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [datasetSubsets, setDatasetSubsets] = useState<EditableDatasetSubset[]>([createEmptyDatasetSubset()]);
  const datasetSubsetsRef = useRef(datasetSubsets);
  const importRef = useRef<HTMLInputElement | null>(null);

  const [input, setInput] = useState<TrainJobInput>(INITIAL_TRAIN_INPUT);

  const [preproc, setPreproc] = useState<Partial<PreprocessOptions>>(INITIAL_PREPROCESS_OPTIONS);
  const prepareBucketsSupported = !PREPARE_BUCKETS_UNSUPPORTED.has(input.modelType);
  const pathHistory = buildPathHistory(jobs, input.modelType);
  const historyJobs = jobs
    .filter(job => job.modelType === input.modelType && job.status !== 'running')
    .slice(0, HISTORY_LIMIT);

  useEffect(() => {
    api.listProfiles().then(ps => {
      setProfiles(ps);
      const def = ps.find(p => p.id === `${input.modelType}-standard`);
      if (def) setInput(i => ({ ...i, profileId: def.id }));
    }).catch(console.error);
    api.listAdvancedProfiles().then(setAdvancedProfiles).catch(console.error);
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

  const setInputValue = (field: keyof TrainJobInput, value: string) => {
    setInput(current => ({ ...current, [field]: value }));
  };

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

  const renderPathSuggestions = (values: string[], onSelect: (value: string) => void) => {
    if (!values.length) return null;

    return (
      <div style={S.pathSuggestionRow}>
        {values.slice(0, 4).map(value => (
          <button
            key={value}
            type="button"
            style={S.pathSuggestionBtn}
            title={value}
            onClick={() => onSelect(value)}
          >
            {value}
          </button>
        ))}
      </div>
    );
  };

  const updateDatasetSubset = (
    subsetId: string,
    updater: (subset: EditableDatasetSubset) => EditableDatasetSubset,
  ) => {
    setDatasetSubsets(prev => prev.map(subset => (
      subset.id === subsetId ? updater(subset) : subset
    )));
  };

  const openFolderPicker = (onSelected: (fullPath: string | null, files: FileList | null) => void) => {
    const el = document.createElement('input');
    el.type = 'file';
    // @ts-ignore — webkitdirectory is non-standard but works in Electron/Chrome
    el.webkitdirectory = true;
    el.onchange = () => {
      const f = el.files?.[0];
      if (f) {
        const fullPath = getNativeFilePath(f);
        if (!fullPath) {
          onSelected(null, el.files ?? null);
          return;
        }
        setError('');
        onSelected(fullPath, el.files ?? null);
      }
    };
    el.click();
  };

  const browseFolder = async (field: keyof TrainJobInput) => {
    const nativePath = await pickNativeDirectory();
    if (nativePath !== undefined) {
      if (nativePath) {
        setError('');
        setInput(i => ({ ...i, [field]: nativePath }));
      }
      return;
    }

    openFolderPicker(fullPath => {
      if (!fullPath) {
        setError(t.errLocalPathAccess);
        return;
      }
      setInput(i => ({ ...i, [field]: fullPath }));
    });
  };

  const browseFile = async (field: keyof TrainJobInput) => {
    const nativePath = await pickNativeFile('model');
    if (nativePath !== undefined) {
      if (nativePath) {
        setError('');
        setInput(i => ({ ...i, [field]: nativePath }));
      }
      return;
    }

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

  const browseOverrideFile = async (field: keyof TrainParams) => {
    const nativePath = await pickNativeFile('binary');
    if (nativePath !== undefined) {
      if (nativePath) {
        setError('');
        setOverrideValue(field, nativePath);
      }
      return;
    }

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

  const browseOverrideFolder = async (field: keyof TrainParams) => {
    const nativePath = await pickNativeDirectory();
    if (nativePath !== undefined) {
      if (nativePath) {
        setError('');
        setOverrideValue(field, nativePath);
      }
      return;
    }

    openFolderPicker(fullPath => {
      if (!fullPath) {
        setError(t.errLocalPathAccess);
        return;
      }
      setOverrideValue(field, fullPath);
    });
  };

  const browseSubsetFolder = async (subsetId: string) => {
    const nativePath = await pickNativeDirectory();
    if (nativePath !== undefined) {
      if (!nativePath) return;

      const previewResult = await loadNativePreviewItems(nativePath);
      const { previews, total } = previewResult ?? { previews: [], total: 0 };
      setError('');
      updateDatasetSubset(subsetId, subset => {
        revokePreviewUrls(subset.previews);
        return { ...subset, imageDir: nativePath, previews, previewTotal: total };
      });
      return;
    }

    openFolderPicker((fullPath, files) => {
      const { previews, total } = buildPreviewItems(files);
      const folderLabel = getBrowserFolderLabel(files);
      updateDatasetSubset(subsetId, subset => {
        revokePreviewUrls(subset.previews);
        return {
          ...subset,
          imageDir: (fullPath ?? subset.imageDir) || folderLabel,
          previews,
          previewTotal: total,
        };
      });
      setError(fullPath ? '' : t.errDatasetPreviewOnly);
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
        <div style={S.topActions}>
          <button type="button" style={S.actionBtn} onClick={exportSettings}>{t.exportSettings}</button>
          <button type="button" style={S.actionBtn} onClick={() => importRef.current?.click()}>{t.importSettings}</button>
          <input
            ref={importRef}
            type="file"
            accept="application/json,.json"
            style={{ display: 'none' }}
            onChange={async e => {
              const inputEl = e.currentTarget;
              const file = inputEl.files?.[0] ?? null;
              await importSettings(file);
              inputEl.value = '';
            }}
          />
        </div>

        {/* ── Basic info ── */}
        <div style={S.section}>
          <div style={S.sectionTitle}>{t.sectionBasic}</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={S.row}>
              <label style={S.label}>{t.fieldJobName}</label>
              <input style={S.input} placeholder={t.fieldJobNamePlaceholder} {...inp('name')} />
            </div>
            <label style={S.checkRow}>
              <input
                type="checkbox"
                checked={input.pauseBeforeTraining !== false}
                onChange={e => setInput(current => ({ ...current, pauseBeforeTraining: e.target.checked }))}
              />
              前処理後、学習開始前に確認で停止する
            </label>
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
              <label style={S.label}>Advanced settings profile</label>
              <select
                style={S.select}
                value={input.advancedProfileId ?? 'balanced'}
                onChange={e => {
                  const profile = advancedProfiles.find(item => item.id === e.target.value);
                  setInput(current => ({
                    ...current,
                    advancedProfileId: e.target.value,
                    overrides: { ...(current.overrides ?? {}), ...(profile?.params ?? {}) },
                  }));
                  if (profile?.preprocessOptions) {
                    setPreproc(current => ({ ...current, ...profile.preprocessOptions }));
                  }
                }}
              >
                {advancedProfiles.map(profile => (
                  <option key={profile.id} value={profile.id}>{profile.name}</option>
                ))}
              </select>
              <div style={S.hint}>
                {advancedProfiles.find(profile => profile.id === input.advancedProfileId)?.description
                  ?? 'Select a reusable advanced profile for trainer-specific settings.'}
              </div>
            </div>
            <div style={S.row}>
              <label style={S.label}>{t.fieldKohyaSsDir}</label>
              <div style={S.inputRow}>
                <input style={S.input} placeholder={t.fieldKohyaSsDirPlaceholder} list="path-history-sdScriptsDir" {...inp('sdScriptsDir')} />
                <button type="button" style={S.browseBtn} onClick={() => browseFolder('sdScriptsDir')}>{t.browseFolder}</button>
              </div>
              {renderPathSuggestions(pathHistory.sdScriptsDir, value => setInputValue('sdScriptsDir', value))}
              <datalist id="path-history-sdScriptsDir">
                {pathHistory.sdScriptsDir.map(value => <option key={value} value={value} />)}
              </datalist>
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
                        {subset.previews.map((item, index) => (
                          <div key={`${item.name}-${index}`} style={S.previewCard}>
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
            <div style={S.row}>
              <label style={S.label}>Working folder</label>
              <div style={S.inputRow}>
                <input style={S.input} placeholder="Blank uses the default data/work folder" list="path-history-workBaseDir" {...inp('workBaseDir')} />
                <button type="button" style={S.browseBtn} onClick={() => browseFolder('workBaseDir')}>{t.browseFolder}</button>
              </div>
              {renderPathSuggestions(pathHistory.workBaseDir, value => setInputValue('workBaseDir', value))}
              <datalist id="path-history-workBaseDir">
                {pathHistory.workBaseDir.map(value => <option key={value} value={value} />)}
              </datalist>
            </div>
            {/* Base model — file picker */}
            <div style={S.row}>
              <label style={S.label}>{t.fieldBaseModelPath}</label>
              <div style={S.inputRow}>
                <input style={S.input} placeholder={t.fieldBaseModelPath} list="path-history-baseModelPath" {...inp('baseModelPath')} />
                <button type="button" style={S.browseBtn} onClick={() => browseFile('baseModelPath')}>{t.browseFile}</button>
              </div>
              {renderPathSuggestions(pathHistory.baseModelPath, value => setInputValue('baseModelPath', value))}
              <datalist id="path-history-baseModelPath">
                {pathHistory.baseModelPath.map(value => <option key={value} value={value} />)}
              </datalist>
            </div>
            {/* Output folder */}
            <div style={S.row}>
              <label style={S.label}>{t.fieldOutputDir}</label>
              <div style={S.inputRow}>
                <input style={S.input} placeholder={t.fieldOutputDir} list="path-history-outputDir" {...inp('outputDir')} />
                <button type="button" style={S.browseBtn} onClick={() => browseFolder('outputDir')}>{t.browseFolder}</button>
              </div>
              {renderPathSuggestions(pathHistory.outputDir, value => setInputValue('outputDir', value))}
              <datalist id="path-history-outputDir">
                {pathHistory.outputDir.map(value => <option key={value} value={value} />)}
              </datalist>
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
                      list="path-history-clipL"
                      value={getOverrideValue('clipL')}
                      onChange={e => setOverrideValue('clipL', e.target.value)}
                    />
                    <button type="button" style={S.browseBtn} onClick={() => browseOverrideFile('clipL')}>{t.browseFile}</button>
                  </div>
                  {renderPathSuggestions(pathHistory.clipL, value => setOverrideValue('clipL', value))}
                  <datalist id="path-history-clipL">
                    {pathHistory.clipL.map(value => <option key={value} value={value} />)}
                  </datalist>
                </div>
                <div style={S.row}>
                  <label style={S.label}>{t.fieldFluxT5xxl}</label>
                  <div style={S.inputRow}>
                    <input
                      style={S.input}
                      placeholder={t.fieldFluxT5xxl}
                      list="path-history-t5xxl"
                      value={getOverrideValue('t5xxl')}
                      onChange={e => setOverrideValue('t5xxl', e.target.value)}
                    />
                    <button type="button" style={S.browseBtn} onClick={() => browseOverrideFile('t5xxl')}>{t.browseFile}</button>
                  </div>
                  {renderPathSuggestions(pathHistory.t5xxl, value => setOverrideValue('t5xxl', value))}
                  <datalist id="path-history-t5xxl">
                    {pathHistory.t5xxl.map(value => <option key={value} value={value} />)}
                  </datalist>
                </div>
                <div style={S.row}>
                  <label style={S.label}>{t.fieldFluxAe}</label>
                  <div style={S.inputRow}>
                    <input
                      style={S.input}
                      placeholder={t.fieldFluxAe}
                      list="path-history-ae"
                      value={getOverrideValue('ae')}
                      onChange={e => setOverrideValue('ae', e.target.value)}
                    />
                    <button type="button" style={S.browseBtn} onClick={() => browseOverrideFile('ae')}>{t.browseFile}</button>
                  </div>
                  {renderPathSuggestions(pathHistory.ae, value => setOverrideValue('ae', value))}
                  <datalist id="path-history-ae">
                    {pathHistory.ae.map(value => <option key={value} value={value} />)}
                  </datalist>
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
                      list="path-history-qwen3"
                      value={getOverrideValue('qwen3')}
                      onChange={e => setOverrideValue('qwen3', e.target.value)}
                    />
                    <button type="button" style={S.browseBtn} onClick={() => browseOverrideFile('qwen3')}>{t.browseFile}</button>
                  </div>
                  {renderPathSuggestions(pathHistory.qwen3, value => setOverrideValue('qwen3', value))}
                  <datalist id="path-history-qwen3">
                    {pathHistory.qwen3.map(value => <option key={value} value={value} />)}
                  </datalist>
                </div>
                <div style={S.row}>
                  <label style={S.label}>{t.fieldAnimaVae}</label>
                  <div style={S.inputRow}>
                    <input
                      style={S.input}
                      placeholder={t.fieldAnimaVae}
                      list="path-history-vae"
                      value={getOverrideValue('vae')}
                      onChange={e => setOverrideValue('vae', e.target.value)}
                    />
                    <button type="button" style={S.browseBtn} onClick={() => browseOverrideFile('vae')}>{t.browseFile}</button>
                  </div>
                  {renderPathSuggestions(pathHistory.vae, value => setOverrideValue('vae', value))}
                  <datalist id="path-history-vae">
                    {pathHistory.vae.map(value => <option key={value} value={value} />)}
                  </datalist>
                </div>
                <div style={S.row}>
                  <label style={S.label}>{t.fieldAnimaT5TokenizerPath}</label>
                  <div style={S.inputRow}>
                    <input
                      style={S.input}
                      placeholder={t.fieldAnimaT5TokenizerPath}
                      list="path-history-t5TokenizerPath"
                      value={getOverrideValue('t5TokenizerPath')}
                      onChange={e => setOverrideValue('t5TokenizerPath', e.target.value)}
                    />
                    <button type="button" style={S.browseBtn} onClick={() => browseOverrideFolder('t5TokenizerPath')}>{t.browseFolder}</button>
                  </div>
                  {renderPathSuggestions(pathHistory.t5TokenizerPath, value => setOverrideValue('t5TokenizerPath', value))}
                  <datalist id="path-history-t5TokenizerPath">
                    {pathHistory.t5TokenizerPath.map(value => <option key={value} value={value} />)}
                  </datalist>
                </div>
                <div style={S.row}>
                  <label style={S.label}>{t.fieldAnimaLlmAdapterPath}</label>
                  <div style={S.inputRow}>
                    <input
                      style={S.input}
                      placeholder={t.fieldAnimaLlmAdapterPath}
                      list="path-history-llmAdapterPath"
                      value={getOverrideValue('llmAdapterPath')}
                      onChange={e => setOverrideValue('llmAdapterPath', e.target.value)}
                    />
                    <button type="button" style={S.browseBtn} onClick={() => browseOverrideFile('llmAdapterPath')}>{t.browseFile}</button>
                  </div>
                  {renderPathSuggestions(pathHistory.llmAdapterPath, value => setOverrideValue('llmAdapterPath', value))}
                  <datalist id="path-history-llmAdapterPath">
                    {pathHistory.llmAdapterPath.map(value => <option key={value} value={value} />)}
                  </datalist>
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
              <input type="checkbox" checked={preproc.normalizeImages !== false}
                onChange={e => setPreproc(p => ({ ...p, normalizeImages: e.target.checked }))} />
              Image normalization
            </label>
            {preproc.normalizeImages !== false && (
              <div style={S.row}>
                <label style={S.label}>Normalized image format</label>
                <select style={S.select} value={preproc.normalizedFormat ?? 'copy'}
                  onChange={e => setPreproc(p => ({ ...p, normalizedFormat: e.target.value as PreprocessOptions['normalizedFormat'] }))}>
                  <option value="copy">Copy original format</option>
                  <option value="png">PNG</option>
                  <option value="jpg">JPEG</option>
                  <option value="webp">WebP</option>
                </select>
              </div>
            )}
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

        <details style={S.section}>
          <summary style={S.summary}>▶ {t.sectionHistory}</summary>
          <div style={{ marginTop: 14 }}>
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

