export type ModelType = 'sd1x' | 'sdxl' | 'flux' | 'anima';
export type JobStatus = 'queued' | 'running' | 'paused' | 'failed' | 'completed' | 'resumable';
export type JobPhase = 'preprocess' | 'train' | 'done';
export type TrainerType = 'lora';
export type WorkflowStepId =
  | 'image-normalize'
  | 'resize'
  | 'tagger'
  | 'caption'
  | 'merge-metadata'
  | 'bucket-cache'
  | 'dataset-config'
  | 'train';
export type WorkflowStepStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped';

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
  saveLastNSteps?: number;
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

export interface AdvancedSettingsProfile {
  id: string;
  name: string;
  description: string;
  params: Partial<TrainParams>;
  preprocessOptions: Partial<PreprocessOptions>;
}

export interface PreprocessOptions {
  normalizeImages: boolean;
  normalizedFormat: 'copy' | 'png' | 'jpg' | 'webp';
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
  trainerType?: TrainerType;
  pauseBeforeTraining?: boolean;
  modelType: ModelType;
  workBaseDir?: string;
  baseModelPath: string;
  datasetDir: string;
  outputDir: string;
  outputName: string;
  datasetSubsets?: DatasetSubsetInput[];
  sdScriptsDir?: string;
  triggerWord?: string;
  repeatCount?: number;
  profileId?: string;
  advancedProfileId?: string;
  overrides?: Partial<TrainParams>;
}

export interface WorkflowArtifact {
  kind: 'directory' | 'file' | 'state' | 'log';
  path: string;
  label?: string;
  createdAt: string;
}

export interface WorkflowStepManifest {
  id: WorkflowStepId;
  name: string;
  status: WorkflowStepStatus;
  startedAt?: string;
  endedAt?: string;
  command?: string[];
  outputs: WorkflowArtifact[];
  error?: string;
}

export interface WorkflowManifest {
  version: 1;
  jobId: string;
  trainerType: TrainerType;
  workDir: string;
  createdAt: string;
  updatedAt: string;
  resumeFromStep?: WorkflowStepId;
  steps: WorkflowStepManifest[];
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
  manifest?: WorkflowManifest;
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
  imageRelativePath?: string;
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
