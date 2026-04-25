import type { Translations } from './ja.js';

const en: Translations = {
  // ── Sidebar ────────────────────────────────────────
  appTitle: '⚡ Kohya LoRA',
  navJobs: 'Jobs',
  navNewJob: '+ New Job',

  // ── JobList ────────────────────────────────────────
  jobListTitle: 'Jobs',
  newJobBtn: '+ New Job',
  colName: 'Name',
  colModel: 'Model',
  colStatus: 'Status',
  colPhase: 'Phase',
  colCreated: 'Created',
  noJobs: 'No jobs yet.',
  noJobsLink: 'Create one.',

  // ── JobDetail ──────────────────────────────────────
  backToList: '← All Jobs',
  tabConsole: 'Console',
  tabParams: 'Params',
  tabTags: 'Tags',
  btnStart: '▶ Start',
  btnStop: '⏹ Stop',
  btnResume: '↩ Resume',
  btnResumeTier: (n: number) => `↩ Resume (tier ${n})`,
  cardPaths: 'Paths',
  cardProgress: 'Progress',
  labelBaseModel: 'Base model',
  labelDataset: 'Dataset',
  labelOutput: 'Output',
  labelName: 'Name',
  labelPhase: 'Phase',
  labelRetry: 'Retry count',
  labelStarted: 'Started',
  labelCompleted: 'Completed',
  loading: 'Loading…',

  // ── NewJob ─────────────────────────────────────────
  newJobTitle: 'New LoRA Job',
  sectionBasic: 'Basic',
  sectionPaths: 'Paths',
  sectionPreproc: 'Preprocessing options',
  fieldJobName: 'Job name',
  fieldJobNamePlaceholder: 'my-character-v1',
  fieldModelType: 'Model type',
  fieldProfile: 'Parameter profile',
  fieldProfileCustom: '— custom —',
  fieldBaseModelPath: 'Base model path (.safetensors)',
  fieldDatasetDir: 'Dataset folder (source images)',
  fieldOutputDir: 'Output folder',
  fieldOutputName: 'Output filename stem',
  fieldOutputNamePlaceholder: 'e.g. my-lora',
  browseFile: 'Browse…',
  browseFolder: 'Browse…',
  wd14Tagger: 'WD14 auto-tagger',
  wd14Threshold: 'Threshold',
  wd14BatchSize: 'Batch size',
  captioning: 'Captioning',
  captionNone: 'None',
  captionBlip: 'BLIP',
  captionGit: 'GIT',
  prepareBuckets: 'Pre-compute latents & buckets',
  submitBtn: '▶ Start Training',
  submitting: 'Starting…',
  errRequired: (field: string) => `"${field}" is required`,

  // ── Console ────────────────────────────────────────
  consoleTitle: (n: number) => `Console (${n} lines)`,
  autoScrollOn: '⏸ auto-scroll',
  autoScrollOff: '▶ auto-scroll',

  // ── TagEditor ─────────────────────────────────────
  tagEditorDatasetDir: 'Dataset folder:',
  tagEditorNotSet: '(not set)',
  tagEditorDesc: 'Tag editing (fine-tune step 3) reads/writes .txt sidecar files from the dataset folder.',
  tagEditorHint: 'After editing tags, re-run preprocessing with WD14 disabled, then resume training.',

  // ── Language ──────────────────────────────────────
  langLabel: 'Language',
};

export default en;
