// ─── Model types ─────────────────────────────────────────────────────────────
export type ModelType = 'sd1x' | 'sdxl' | 'flux' | 'anima';

export type JobStatus =
  | 'queued'
  | 'running'
  | 'paused'
  | 'failed'
  | 'completed'
  | 'resumable';

export type JobPhase = 'preprocess' | 'train' | 'done';

// ─── Training parameters ──────────────────────────────────────────────────────
export interface TrainParams {
  networkDim: number;
  networkAlpha: number;
  learningRate: number;
  unetLr?: number;
  textEncoderLr?: number;
  batchSize: number;
  maxTrainEpochs?: number;
  maxTrainSteps?: number;
  optimizerType: string;
  lrScheduler: string;
  lrWarmupSteps?: number;
  mixedPrecision: 'no' | 'fp16' | 'bf16';
  gradientCheckpointing: boolean;
  cacheLatents: boolean;
  cacheLatentsToDisk: boolean;
  saveEveryNEpochs?: number;
  saveEveryNSteps?: number;
  saveLastNEpochs?: number;
  saveState: boolean;
  saveModelAs: 'safetensors' | 'ckpt';
  // Flux-specific
  clipL?: string;
  t5xxl?: string;
  ae?: string;
}

// ─── Fixed parameter profile ──────────────────────────────────────────────────
export interface LoRAProfile {
  id: string;
  name: string;
  description: string;
  params: TrainParams;
  lockedFields: (keyof TrainParams)[];
}

// ─── Preprocessing ────────────────────────────────────────────────────────────
export interface PreprocessOptions {
  runResize: boolean;
  maxResolution: string;
  runWd14Tagger: boolean;
  wd14Threshold: number;
  wd14BatchSize: number;
  runCaptioning: 'blip' | 'git' | 'none';
  runPrepareBuckets: boolean;
  bucketResoSteps: number;
  captionExtension: string;
  skipPreprocessing: boolean;
}

export interface DatasetSubsetInput {
  imageDir: string;
  triggerWord?: string;
  repeatCount?: number;
}

export const defaultPreprocessOptions: PreprocessOptions = {
  runResize: false,
  maxResolution: '1024x1024',
  runWd14Tagger: true,
  wd14Threshold: 0.35,
  wd14BatchSize: 8,
  runCaptioning: 'none',
  runPrepareBuckets: false,
  bucketResoSteps: 64,
  captionExtension: '.txt',
  skipPreprocessing: false,
};

// ─── Job input ────────────────────────────────────────────────────────────────
export interface TrainJobInput {
  name: string;
  modelType: ModelType;
  baseModelPath: string;
  datasetDir: string;
  outputDir: string;
  outputName: string;
  datasetSubsets?: DatasetSubsetInput[];
  sdScriptsDir?: string;
  triggerWord?: string;
  repeatCount?: number;
  profileId?: string;
  overrides?: Partial<TrainParams>;
}

// ─── Dataset snapshot (for fine-tune loop) ────────────────────────────────────
export interface DatasetSnapshot {
  id: string;
  jobId: string;
  version: number;
  imageList: Array<{ path: string; hash: string }>;
  tagsHash: string;
  createdAt: string;
}

// ─── Job (runtime record) ─────────────────────────────────────────────────────
export interface TrainJob {
  id: string;
  name: string;
  status: JobStatus;
  currentPhase: JobPhase;
  modelType: ModelType;
  workDir: string;
  stateDir?: string;
  input: TrainJobInput;
  preprocessOptions: PreprocessOptions;
  params: TrainParams;
  errorMessage?: string;
  retryCount: number;
  snapshotId?: string;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  completedAt?: string;
}

// ─── Log event (JSON-line protocol between Python bridge and server) ──────────
export interface LogEvent {
  jobId: string;
  ts: number;
  type: 'stdout' | 'stderr' | 'system' | 'exit';
  level: 'info' | 'warn' | 'error' | 'progress';
  message: string;
  data?: {
    epoch?: number;
    step?: number;
    totalSteps?: number;
    loss?: number;
    progress?: number;
    exitCode?: number;
  };
}

// ─── Retry tiers ──────────────────────────────────────────────────────────────
export type RetryTier = 'latest-state' | 'prev-state' | 'model-conservative';

export interface RetryConfig {
  tier: RetryTier;
  stateDir?: string;
  paramsOverride?: Partial<TrainParams>;
}

/** Conservative parameter overrides applied at tier 3 */
export const conservativeOverride: Partial<TrainParams> = {
  batchSize: 1,
  gradientCheckpointing: true,
  cacheLatents: true,
  cacheLatentsToDisk: true,
  mixedPrecision: 'bf16',
};

// ─── Default profiles ─────────────────────────────────────────────────────────
export const DEFAULT_PROFILES: LoRAProfile[] = [
  {
    id: 'sd1x-standard',
    name: 'SD 1.x Standard',
    description: 'Balanced settings for SD 1.x LoRA training',
    params: {
      networkDim: 32,
      networkAlpha: 16,
      learningRate: 1e-4,
      batchSize: 2,
      maxTrainEpochs: 10,
      optimizerType: 'AdamW8bit',
      lrScheduler: 'cosine_with_restarts',
      mixedPrecision: 'fp16',
      gradientCheckpointing: true,
      cacheLatents: true,
      cacheLatentsToDisk: false,
      saveEveryNEpochs: 2,
      saveLastNEpochs: 3,
      saveState: true,
      saveModelAs: 'safetensors',
    },
    lockedFields: ['networkDim', 'networkAlpha', 'optimizerType', 'saveState'],
  },
  {
    id: 'sdxl-standard',
    name: 'SDXL Standard',
    description: 'Balanced settings for SDXL LoRA training',
    params: {
      networkDim: 64,
      networkAlpha: 32,
      learningRate: 4e-5,
      unetLr: 4e-5,
      textEncoderLr: 4e-5,
      batchSize: 2,
      maxTrainEpochs: 10,
      optimizerType: 'AdamW8bit',
      lrScheduler: 'cosine_with_restarts',
      mixedPrecision: 'bf16',
      gradientCheckpointing: true,
      cacheLatents: true,
      cacheLatentsToDisk: true,
      saveEveryNEpochs: 2,
      saveLastNEpochs: 3,
      saveState: true,
      saveModelAs: 'safetensors',
    },
    lockedFields: ['networkDim', 'networkAlpha', 'optimizerType', 'saveState'],
  },
  {
    id: 'flux-standard',
    name: 'FLUX Standard',
    description: 'Balanced settings for FLUX LoRA training',
    params: {
      networkDim: 16,
      networkAlpha: 8,
      learningRate: 8e-5,
      batchSize: 1,
      maxTrainEpochs: 16,
      optimizerType: 'AdamW8bit',
      lrScheduler: 'constant',
      mixedPrecision: 'bf16',
      gradientCheckpointing: true,
      cacheLatents: true,
      cacheLatentsToDisk: true,
      saveEveryNEpochs: 4,
      saveLastNEpochs: 2,
      saveState: true,
      saveModelAs: 'safetensors',
    },
    lockedFields: ['networkDim', 'networkAlpha', 'optimizerType', 'saveState'],
  },
  {
    id: 'anima-standard',
    name: 'Anima Standard',
    description: 'Balanced settings for Anima LoRA training',
    params: {
      networkDim: 32,
      networkAlpha: 16,
      learningRate: 1e-4,
      batchSize: 1,
      maxTrainEpochs: 10,
      optimizerType: 'AdamW8bit',
      lrScheduler: 'cosine_with_restarts',
      mixedPrecision: 'bf16',
      gradientCheckpointing: true,
      cacheLatents: true,
      cacheLatentsToDisk: true,
      saveEveryNEpochs: 2,
      saveLastNEpochs: 3,
      saveState: true,
      saveModelAs: 'safetensors',
    },
    lockedFields: ['networkDim', 'networkAlpha', 'optimizerType', 'saveState'],
  },
];
