# Kohya LoRA Builder

[kohya / sd-scripts](https://github.com/kohya-ss/sd-scripts.git) 系の LoRA 学習を、手順とパラメータを見通せる UI で操作するためのラッパーです。

このプロジェクトはまだプロトタイプですが、デスクトップ版とブラウザ版の基本ワークフローは実行できる状態です。目的は sd-scripts を直接触らずに、画像投入、前処理、タグ確認、パラメータ確認、学習開始までを一つの UI で扱えるようにすることです。

## 主な機能

- Electron デスクトップアプリ
- ブラウザモードの Web UI
- SD 1.x / SDXL / FLUX / Anima 向け LoRA ジョブ作成
- 複数データセットサブセット
- 画像正規化、リサイズ、WD14 タグ付け、キャプション生成の前処理
- 前処理完了後に一旦停止するポーズモード
- ポーズ中のパラメータ確認・変更
- ポーズ中のタグ編集と画像プレビュー
- trigger word を学習タグから分離し、学習用 `.train.txt` を自動生成
- ジョブ履歴、ログ表示、失敗時の再開
- ヒストリによる簡単再設定

## 構成

```text
apps/desktop/   Electron デスクトップアプリ
apps/server/    Fastify API サーバー、ジョブ管理、SQLite
apps/web/       React Web UI
python/bridge/  sd-scripts を呼び出す Python ブリッジ
sd-scripts/     外部リポジトリ。直接変更しない
data/           SQLite などの実行時データ
work/           ジョブごとの作業フォルダ
```

`data/`、`work/`、`.test*`、`test_data/` は Git 管理外です。

## 必要なもの

- [Node.js LTS](https://nodejs.org/ja)
- npm
- [Git](https://git-scm.com/)
- Python 3.10 - 3.12
- NVIDIA GPU 環境を推奨
- 多めの空きディスク Windowsの場合は10GBぐらい必要になりそう(ほとんどpython)

Python が見つからない場合、Windows では `install.ps1 -AutoPython` でローカルの `.python/` に Python 3.12 を取得できます。

## セットアップ
Git:
```bash
git clone https://github.com/mith-mmk/kohya_sd-script-web-ui.git
```

Windows:

```powershell
.\install.ps1
```

Python も自動取得したい場合:

```powershell
.\install.ps1 -AutoPython
```

このスクリプトは Node 依存関係、sd-scripts、Python 仮想環境、PyTorch、sd-scripts 依存関係、WD14 関連依存を準備します。

## 起動

デスクトップ版:

```powershell
.\start-desktop.ps1
```

ビルド成果物が古い場合は自動でビルドしてから起動します。ポートを変える場合:

```powershell
.\start-desktop.ps1 -Port 3010
```

ブラウザ開発モード:

```powershell
npm run dev
```

標準では API サーバーは `http://127.0.0.1:3001`、Vite は `http://localhost:5173` で起動します。

## 使い方

1. 新規ジョブを作成する
2. モデルタイプ、ベースモデル、データセット、出力先を指定する
3. 必要に応じてサブセット、trigger word、repeat count を設定する
4. 前処理オプションを選ぶ
5. 学習を開始する
6. ポーズモードが有効な場合、前処理後に `paused` で停止する
7. タグ編集タブで画像を見ながら prompt を修正する
8. パラメータタブで学習パラメータを確認・変更する
9. 「学習を続行」で training フェーズを開始する

タグ編集で保存するのは managed prompt です。元のデータセット内の `.txt` は直接変更しません。学習時には trigger word を先頭に付けた `.train.txt` が生成されます。

## 開発コマンド

```powershell
npm run dev          # server + web
npm run dev:all      # server + web + desktop
npm run build        # server + web
npm run build:all    # server + web + desktop
npm run desktop      # ビルド済み desktop を起動
npm run package:desktop
```

## 環境変数

必要に応じて `.env` に設定します。`.env` は Git 管理外です。

```text
HOST=127.0.0.1
PORT=3001
DB_PATH=./data/kohya.db
WORK_BASE=./work
PYTHON_BIN=./.venv/Scripts/python.exe
SD_SCRIPTS_DIR=./sd-scripts
BRIDGE_DIR=./python/bridge
LOG_LEVEL=info
```

## 注意

- `sd-scripts/` は外部リポジトリとして扱い、このプロジェクト側から直接変更しません。
- 作業用ファイルや検証データは `.test*` または `test_data/` に置きます。
- パス、API キー、作業ログ、個人情報を Git 管理対象に置かないでください。
- ブラウザモードをサーバー公開する場合は、認証・HTTPS・サーバー側権限チェックを必ず追加してください。
- バイナリー化はまだできていません
- プレビューなのでバグが多いです
- Lora以外は現在対応していません
