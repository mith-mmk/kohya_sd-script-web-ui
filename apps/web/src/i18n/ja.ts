export interface Translations {
  // ── Sidebar ────────────────────────────────────────
  appTitle: string;
  navJobs: string;
  navNewJob: string;
  // ── JobList ────────────────────────────────────────
  jobListTitle: string;
  newJobBtn: string;
  colName: string;
  colModel: string;
  colStatus: string;
  colPhase: string;
  colCreated: string;
  noJobs: string;
  noJobsLink: string;
  // ── JobDetail ──────────────────────────────────────
  backToList: string;
  tabConsole: string;
  tabParams: string;
  tabTags: string;
  btnStart: string;
  btnStop: string;
  btnResume: string;
  btnResumeTier: (n: number) => string;
  cardPaths: string;
  cardProgress: string;
  labelBaseModel: string;
  labelDataset: string;
  labelOutput: string;
  labelName: string;
  labelPhase: string;
  labelRetry: string;
  labelStarted: string;
  labelCompleted: string;
  loading: string;
  // ── NewJob ─────────────────────────────────────────
  newJobTitle: string;
  sectionBasic: string;
  sectionPaths: string;
  sectionPreproc: string;
  fieldJobName: string;
  fieldJobNamePlaceholder: string;
  fieldModelType: string;
  fieldProfile: string;
  fieldProfileCustom: string;
  fieldBaseModelPath: string;
  fieldDatasetDir: string;
  fieldOutputDir: string;
  fieldOutputName: string;
  fieldOutputNamePlaceholder: string;
  browseFile: string;
  browseFolder: string;
  wd14Tagger: string;
  wd14Threshold: string;
  wd14BatchSize: string;
  captioning: string;
  captionNone: string;
  captionBlip: string;
  captionGit: string;
  prepareBuckets: string;
  submitBtn: string;
  submitting: string;
  errRequired: (field: string) => string;
  // ── Console ────────────────────────────────────────
  consoleTitle: (n: number) => string;
  autoScrollOn: string;
  autoScrollOff: string;
  // ── TagEditor ─────────────────────────────────────
  tagEditorDatasetDir: string;
  tagEditorNotSet: string;
  tagEditorDesc: string;
  tagEditorHint: string;
  // ── Language ──────────────────────────────────────
  langLabel: string;
}

const ja: Translations = {
  appTitle: '⚡ Kohya LoRA',
  navJobs: 'ジョブ一覧',
  navNewJob: '+ 新規ジョブ',
  jobListTitle: 'ジョブ一覧',
  newJobBtn: '+ 新規ジョブ',
  colName: '名前',
  colModel: 'モデル',
  colStatus: 'ステータス',
  colPhase: 'フェーズ',
  colCreated: '作成日時',
  noJobs: 'ジョブがありません。',
  noJobsLink: '作成する',
  backToList: '← 一覧に戻る',
  tabConsole: 'コンソール',
  tabParams: 'パラメータ',
  tabTags: 'タグ編集',
  btnStart: '▶ 開始',
  btnStop: '⏹ 停止',
  btnResume: '↩ 再開',
  btnResumeTier: (n: number) => `↩ 再開 (tier ${n})`,
  cardPaths: 'パス',
  cardProgress: '進捗',
  labelBaseModel: 'ベースモデル',
  labelDataset: 'データセット',
  labelOutput: '出力先',
  labelName: '出力名',
  labelPhase: 'フェーズ',
  labelRetry: 'リトライ回数',
  labelStarted: '開始日時',
  labelCompleted: '完了日時',
  loading: '読み込み中…',
  newJobTitle: '新規 LoRA ジョブ',
  sectionBasic: '基本設定',
  sectionPaths: 'パス設定',
  sectionPreproc: '前処理オプション',
  fieldJobName: 'ジョブ名',
  fieldJobNamePlaceholder: '例: my-character-v1',
  fieldModelType: 'モデルタイプ',
  fieldProfile: 'パラメータプロファイル',
  fieldProfileCustom: '— カスタム —',
  fieldBaseModelPath: 'ベースモデルパス (.safetensors)',
  fieldDatasetDir: 'データセットフォルダ（学習画像）',
  fieldOutputDir: '出力フォルダ',
  fieldOutputName: '出力ファイル名（拡張子なし）',
  fieldOutputNamePlaceholder: '例: my-lora',
  browseFile: '参照…',
  browseFolder: '参照…',
  wd14Tagger: 'WD14 自動タグ付け',
  wd14Threshold: 'しきい値',
  wd14BatchSize: 'バッチサイズ',
  captioning: 'キャプション生成',
  captionNone: 'なし',
  captionBlip: 'BLIP',
  captionGit: 'GIT',
  prepareBuckets: 'バケット & 潜在変数を事前計算',
  submitBtn: '▶ 学習開始',
  submitting: '開始中…',
  errRequired: (field: string) => `"${field}" は必須です`,
  consoleTitle: (n: number) => `コンソール (${n} 行)`,
  autoScrollOn: '⏸ 自動スクロール',
  autoScrollOff: '▶ 自動スクロール',
  tagEditorDatasetDir: 'データセットフォルダ:',
  tagEditorNotSet: '(未設定)',
  tagEditorDesc: 'タグ編集（ファインチューン step 3）は .txt サイドカーファイルを読み書きします。',
  tagEditorHint: 'タグ編集後は WD14 を無効にして前処理を再実行し、学習を再開してください。',
  langLabel: '言語',
};

export default ja;
