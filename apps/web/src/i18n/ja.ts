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
  sectionDatasets: string;
  sectionPaths: string;
  sectionPreproc: string;
  fieldJobName: string;
  fieldJobNamePlaceholder: string;
  fieldModelType: string;
  fieldProfile: string;
  fieldProfileCustom: string;
  fieldKohyaSsDir: string;
  fieldKohyaSsDirPlaceholder: string;
  fieldTriggerWord: string;
  fieldTriggerWordPlaceholder: string;
  fieldRepeatCount: string;
  fieldBaseModelPath: string;
  fieldDatasetDir: string;
  fieldOutputDir: string;
  fieldOutputName: string;
  fieldOutputNamePlaceholder: string;
  datasetSubsetTitle: (n: number) => string;
  addDatasetSubset: string;
  removeDatasetSubset: string;
  datasetPreviewTitle: string;
  datasetPreviewEmpty: string;
  datasetPreviewCount: (shown: number, total: number) => string;
  datasetPreviewMore: (remaining: number) => string;
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
  skipPreprocessing: string;
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
  sectionDatasets: 'データセットサブセット',
  sectionPaths: 'パス設定',
  sectionPreproc: '前処理オプション',
  fieldJobName: 'ジョブ名',
  fieldJobNamePlaceholder: '例: my-character-v1',
  fieldModelType: 'モデルタイプ',
  fieldProfile: 'パラメータプロファイル',
  fieldProfileCustom: '— カスタム —',
  fieldKohyaSsDir: 'kohya_ss / sd-scripts フォルダ（任意）',
  fieldKohyaSsDirPlaceholder: '空欄ならサーバー設定を使用',
  fieldTriggerWord: 'トリガーワード',
  fieldTriggerWordPlaceholder: '例: my-character',
  fieldRepeatCount: '繰り返し回数',
  fieldBaseModelPath: 'ベースモデルパス (.safetensors)',
  fieldDatasetDir: 'データセットフォルダ（学習画像）',
  fieldOutputDir: '出力フォルダ',
  fieldOutputName: '出力ファイル名（拡張子なし）',
  fieldOutputNamePlaceholder: '例: my-lora',
  datasetSubsetTitle: (n: number) => `サブセット ${n}`,
  addDatasetSubset: '+ サブセット追加',
  removeDatasetSubset: '削除',
  datasetPreviewTitle: '画像プレビュー',
  datasetPreviewEmpty: 'このサブセットのフォルダを「参照…」から選ぶと、先頭の画像をここに表示します。',
  datasetPreviewCount: (shown: number, total: number) => `${total} 枚中 ${shown} 枚を表示`,
  datasetPreviewMore: (remaining: number) => `ほか ${remaining} 枚`,
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
  skipPreprocessing: '前処理をスキップ（タグ・キャプションは既に用意済み）',
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
