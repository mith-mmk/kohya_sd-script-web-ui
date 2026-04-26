export type ModelType = 'sd1x' | 'sdxl' | 'flux' | 'anima';
export type JobStatus = 'queued' | 'running' | 'paused' | 'failed' | 'completed' | 'resumable';
export type JobPhase = 'preprocess' | 'train' | 'done';

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
  mixedPrecision: 'no' | 'fp16' | 'bf16';
  gradientCheckpointing: boolean;
  cacheLatents: boolean;
  cacheLatentsToDisk: boolean;
  saveEveryNEpochs?: number;
  saveEveryNSteps?: number;
  saveLastNEpochs?: number;
  saveState: boolean;
  saveModelAs: 'safetensors' | 'ckpt';
  clipL?: string;
  t5xxl?: string;
  ae?: string;
  qwen3?: string;
  vae?: string;
  t5TokenizerPath?: string;
  llmAdapterPath?: string;
}

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
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  completedAt?: string;
}

export interface PromptFileEntry {
  id: string;
  relativePath: string;
  baseName: string;
  updatedAt: string;
  size: number;
}

export interface PromptSubsetEntry {
  workKey: string;
  label: string;
  imageDir: string;
  effectiveDir: string;
  available: boolean;
  items: PromptFileEntry[];
}

export interface PromptListResponse {
  promptExtension: string;
  trainingExtension: string;
  subsets: PromptSubsetEntry[];
}

export interface LogEvent {
  jobId: string;
  ts: number;
  type: 'stdout' | 'stderr' | 'system' | 'exit';
  level: 'info' | 'warn' | 'error' | 'progress';
  message: string;
  data?: { epoch?: number; step?: number; totalSteps?: number; loss?: number; progress?: number; exitCode?: number };
}

export interface LoRAProfile {
  id: string;
  name: string;
  description: string;
  params: TrainParams;
  lockedFields: (keyof TrainParams)[];
}
