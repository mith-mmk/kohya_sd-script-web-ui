#Requires -Version 5.1
[CmdletBinding()]
param(
  # Python 3.10-3.12 が見つからないとき自動でダウンロードする
  [switch]$AutoPython,
  # 自動取得するバージョン (3.10 / 3.11 / 3.12)
  [ValidateSet('3.10', '3.11', '3.12')]
  [string]$PythonVersion = '3.12'
)

$ErrorActionPreference = 'Stop'
$Host.UI.RawUI.WindowTitle = 'Kohya LoRA Builder - インストーラ'

# ── カラー出力ヘルパー ────────────────────────────────────────────
function Write-Step  ($msg) { Write-Host "  $msg" -ForegroundColor Cyan }
function Write-Ok    ($msg) { Write-Host "  [ OK ] $msg" -ForegroundColor Green }
function Write-Warn  ($msg) { Write-Host "  [WARN] $msg" -ForegroundColor Yellow }
function Write-Fail  ($msg) { Write-Host "  [ERR]  $msg" -ForegroundColor Red; Read-Host 'Enterで終了'; exit 1 }

# ── Python 自動取得 (python-build-standalone install_only) ────────
# tar コマンドは Windows 10 1803 以降に標準搭載。
function Invoke-DownloadPython {
  param(
    [string]$Version,   # '3.10' / '3.11' / '3.12'
    [string]$DestDir    # 展開先ディレクトリ (例: $Root\.python)
  )

  # python-build-standalone の既知 URL テーブル (install_only, x64 Windows MSVC)
  $urls = @{
    '3.12' = 'https://github.com/indygreg/python-build-standalone/releases/download/20241002/cpython-3.12.7+20241002-x86_64-pc-windows-msvc-install_only.tar.gz'
    '3.11' = 'https://github.com/indygreg/python-build-standalone/releases/download/20241002/cpython-3.11.10+20241002-x86_64-pc-windows-msvc-install_only.tar.gz'
    '3.10' = 'https://github.com/indygreg/python-build-standalone/releases/download/20241002/cpython-3.10.15+20241002-x86_64-pc-windows-msvc-install_only.tar.gz'
  }
  $url = $urls[$Version]
  if (-not $url) { Write-Fail "Python $Version の URL が見つかりません。3.10/3.11/3.12 を指定してください。" }

  $tmpTar = "$env:TEMP\py-standalone-$Version.tar.gz"
  $tmpDir = "$env:TEMP\py-standalone-$Version"

  Write-Step "      Python $Version をダウンロード中 (約 20 MB)..."
  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
  Invoke-WebRequest -Uri $url -OutFile $tmpTar -UseBasicParsing

  Write-Step "      展開中..."
  if (Test-Path $tmpDir) { Remove-Item $tmpDir -Recurse -Force }
  New-Item -ItemType Directory $tmpDir -Force | Out-Null
  # tar は Windows 10 1803+ 標準 (%SystemRoot%\System32\tar.exe)
  & tar -xf $tmpTar -C $tmpDir
  if ($LASTEXITCODE -ne 0) { Write-Fail "tar 展開に失敗しました。Windows 10 1803 以降が必要です。" }

  # install_only は python/ サブフォルダに展開される
  $srcPython = Join-Path $tmpDir 'python'
  if (-not (Test-Path $srcPython)) { Write-Fail "展開後のディレクトリが見つかりません: $srcPython" }

  if (Test-Path $DestDir) { Remove-Item $DestDir -Recurse -Force }
  Move-Item $srcPython $DestDir

  Remove-Item $tmpTar  -Force -ErrorAction SilentlyContinue
  Remove-Item $tmpDir  -Recurse -Force -ErrorAction SilentlyContinue

  $exe = Join-Path $DestDir 'python.exe'
  if (-not (Test-Path $exe)) { Write-Fail "python.exe が見つかりません: $exe" }
  Write-Ok "Python $Version を $DestDir に展開しました。"
  return $exe
}

function Get-PyTorchIndexUrl {
  $nvidiaSmi = Get-Command 'nvidia-smi' -ErrorAction SilentlyContinue
  if ($nvidiaSmi) {
    try {
      $smiText = (& $nvidiaSmi.Source 2>$null | Out-String)
      if ($smiText -match 'CUDA Version:\s*(\d+)\.(\d+)') {
        $major = [int]$Matches[1]
        $minor = [int]$Matches[2]
        if ($major -gt 12 -or ($major -eq 12 -and $minor -ge 4)) {
          return 'https://download.pytorch.org/whl/cu124'
        }
        if ($major -eq 12 -and $minor -ge 1) {
          return 'https://download.pytorch.org/whl/cu121'
        }
        if ($major -gt 11 -or ($major -eq 11 -and $minor -ge 8)) {
          return 'https://download.pytorch.org/whl/cu118'
        }
      }
    }
    catch {
      Write-Warn "CUDA バージョンの判定に失敗したため CPU 版 PyTorch を使用します。"
    }
  }

  return 'https://download.pytorch.org/whl/cpu'
}

function Install-OnnxRuntimePackages {
  param(
    [string]$PipExe,
    [bool]$PreferGpu
  )

  Write-Step "      Hugging Face Hub / ONNX / ONNX Runtime をインストール中..."
  & $PipExe install huggingface_hub --quiet
  if ($LASTEXITCODE -ne 0) {
    Write-Fail "huggingface_hub のインストールに失敗しました。"
  }
  if ($PreferGpu) {
    & $PipExe install onnx onnxruntime-gpu --quiet
    if ($LASTEXITCODE -eq 0) {
      Write-Ok "huggingface_hub / onnx / onnxruntime-gpu インストール完了。"
      return
    }
    Write-Warn "onnxruntime-gpu のインストールに失敗したため、CPU 版へフォールバックします。"
  }

  & $PipExe install onnx onnxruntime --quiet
  if ($LASTEXITCODE -ne 0) {
    Write-Fail "onnx / onnxruntime のインストールに失敗しました。"
  }
  Write-Ok "huggingface_hub / onnx / onnxruntime インストール完了。"
}

# ── 作業ディレクトリをスクリプトのある場所に固定 ─────────────────
$Root = $PSScriptRoot
Set-Location $Root

Write-Host ""
Write-Host "============================================================" -ForegroundColor Magenta
Write-Host "  Kohya LoRA Builder - Windows インストーラ (PowerShell)"    -ForegroundColor Magenta
Write-Host "============================================================" -ForegroundColor Magenta
Write-Host ""

# ─────────────────────────────────────────────────────────────────
# 1. Node.js 確認
# ─────────────────────────────────────────────────────────────────
Write-Step "[1/7] Node.js を確認中..."
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Fail "Node.js が見つかりません。https://nodejs.org/ から LTS 版をインストールしてください。"
}
$nodeVer = node -v
$npmVer = npm -v
Write-Ok "Node.js $nodeVer / npm $npmVer"

# ─────────────────────────────────────────────────────────────────
# 2. Python 確認
# ─────────────────────────────────────────────────────────────────
Write-Step "[2/7] Python を確認中..."
$pythonCmd = $null
$pythonExe = $null
$pythonArgs = @()
$localPyExe = "$Root\.python\python.exe"
if (Test-Path $localPyExe) {
  $ver = & $localPyExe --version 2>&1
  if ($ver -match '(\d+)\.(\d+)') {
    $major = [int]$Matches[1]
    $minor = [int]$Matches[2]
    if ($major -eq 3 -and $minor -ge 10 -and $minor -le 12) {
      Write-Ok "ローカル Python を使用します: $ver ($localPyExe)"
      $pythonExe = $localPyExe
      $pythonArgs = @()
      $pythonCmd = $localPyExe
    }
  }
}

if (-not $pythonCmd) {
  foreach ($candidate in @(
      @{ exe = 'py'; args = @('-3.12') },
      @{ exe = 'py'; args = @('-3.11') },
      @{ exe = 'py'; args = @('-3.10') },
      @{ exe = 'python'; args = @() },
      @{ exe = 'python3'; args = @() },
      @{ exe = 'py'; args = @() }
    )) {
    $exe = $candidate.exe
    $args = $candidate.args
    if (-not (Get-Command $exe -ErrorAction SilentlyContinue)) { continue }

    $ver = & $exe @args --version 2>&1
    if ($ver -match '(\d+)\.(\d+)') {
      $major = [int]$Matches[1]
      $minor = [int]$Matches[2]
      if ($major -eq 3 -and $minor -ge 10 -and $minor -le 12) {
        $pythonCmd = "$exe $($args -join ' ')".Trim()
        $pythonExe = $exe
        $pythonArgs = $args
        Write-Ok "$pythonCmd ($ver)"
        break
      }
    }
  }
}

if (-not $pythonCmd) {
  if ($AutoPython) {
    Write-Warn "Python 3.10-3.12 が見つかりません。python-build-standalone から取得します..."
    $localPyExe = Invoke-DownloadPython -Version $PythonVersion -DestDir "$Root\.python"
    $pythonExe = $localPyExe
    $pythonArgs = @()
    $pythonCmd = $localPyExe
  }
  else {
    Write-Warn "Python 3.10-3.12 が見つかりません。"
    Write-Warn "  オプション 1: https://www.python.org/ から 3.10/3.11/3.12 をインストールして再実行"
    Write-Warn "  オプション 2: .\install.ps1 -AutoPython          (3.12 を自動取得)"
    Write-Warn "  オプション 3: .\install.ps1 -AutoPython -PythonVersion 3.10"
    Write-Fail "Python が見つかりません。"
  }
}

# ─────────────────────────────────────────────────────────────────
# 3. sd-scripts clone
# ─────────────────────────────────────────────────────────────────
Write-Step "[3/7] sd-scripts を確認中..."
if (Test-Path "$Root\sd-scripts") {
  Write-Ok "既存の sd-scripts ディレクトリを使用します。"
}
else {
  if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    Write-Fail "sd-scripts を clone するために Git が必要です。https://git-scm.com/ をインストールしてください。"
  }

  Write-Step "      sd-scripts を clone 中..."
  & git clone https://github.com/kohya-ss/sd-scripts.git
  if ($LASTEXITCODE -ne 0) { Write-Fail "sd-scripts の clone に失敗しました。" }
  Write-Ok "sd-scripts を clone しました。"
}

# ─────────────────────────────────────────────────────────────────
# 4. npm install
# ─────────────────────────────────────────────────────────────────
Write-Step "[4/7] Node.js 依存関係をインストール中..."
npm install
if ($LASTEXITCODE -ne 0) { Write-Fail "npm install に失敗しました。" }
Write-Ok "完了。"

# ─────────────────────────────────────────────────────────────────
# 5. TypeScript ビルド
# ─────────────────────────────────────────────────────────────────
Write-Step "[5/7] TypeScript をビルド中..."
npm run build
if ($LASTEXITCODE -ne 0) { Write-Fail "ビルドに失敗しました。" }
Write-Ok "完了。"

# ─────────────────────────────────────────────────────────────────
# 6. Python venv セットアップ
# ─────────────────────────────────────────────────────────────────
Write-Step "[6/7] Python 仮想環境をセットアップ中..."
if ((Test-Path "$Root\venv") -and (-not (Test-Path "$Root\.venv"))) {
  Write-Warn "既存の venv が見つかりました。以後は .venv を使用するため、新規作成します。"
}

if (-not (Test-Path "$Root\.venv")) {
  Write-Step "      .venv を作成中..."
  & $pythonExe @pythonArgs -m venv "$Root\.venv"
  if ($LASTEXITCODE -ne 0) { Write-Fail ".venv の作成に失敗しました。" }
}
else {
  Write-Step "      既存の .venv を使用します。"
}

$venvPython = "$Root\.venv\Scripts\python.exe"
$venvPip = "$Root\.venv\Scripts\pip.exe"

Write-Step "      pip をアップグレード中..."
& $venvPython -m pip install --upgrade pip --quiet

$torchIndexUrl = Get-PyTorchIndexUrl
$torchChannel = Split-Path $torchIndexUrl -Leaf
Write-Step "      PyTorch / torchvision をインストール中 ($torchChannel)..."
& $venvPip install torch torchvision --index-url $torchIndexUrl --quiet
if ($LASTEXITCODE -ne 0) {
  Write-Fail "PyTorch / torchvision のインストールに失敗しました。"
}
Write-Ok "PyTorch / torchvision インストール完了。"

Install-OnnxRuntimePackages -PipExe $venvPip -PreferGpu ($torchChannel -ne 'cpu')

Write-Step "      sd-scripts の依存関係をインストール中..."
# requirements.txt 内の `-e .` は CWD 相対なので sd-scripts ディレクトリで実行する
Push-Location "$Root\sd-scripts"
try {
  & $venvPip install -r requirements.txt --quiet
  if ($LASTEXITCODE -ne 0) {
    Write-Warn "requirements.txt の一部でエラーが発生しました。"
  }
  else {
    Write-Ok "requirements.txt インストール完了。"
  }
}
finally {
  Pop-Location
}

# ─────────────────────────────────────────────────────────────────
# 7. データディレクトリ作成
# ─────────────────────────────────────────────────────────────────
Write-Step "[7/7] データディレクトリを作成中..."
@('data', 'work') | ForEach-Object {
  if (-not (Test-Path "$Root\$_")) { New-Item -ItemType Directory "$Root\$_" | Out-Null }
}
Write-Ok "完了。"

# ─────────────────────────────────────────────────────────────────
# .env 生成（存在しない場合のみ）
# ─────────────────────────────────────────────────────────────────
if (-not (Test-Path "$Root\.env")) {
  Write-Step "      .env を生成中..."
  @"
# Kohya LoRA Builder 設定
PORT=3001
HOST=127.0.0.1
DB_PATH=$Root\data\kohya.db
SD_SCRIPTS_DIR=$Root\sd-scripts
BRIDGE_DIR=$Root\python\bridge
WORK_BASE=$Root\work
PYTHON_BIN=$Root\.venv\Scripts\python.exe
"@ | Set-Content "$Root\.env" -Encoding UTF8
  Write-Ok ".env を作成しました。"
}

Write-Host ""
Write-Host "============================================================" -ForegroundColor Magenta
Write-Host "  インストール完了！" -ForegroundColor Green
Write-Host ""
Write-Host "  起動方法:" -ForegroundColor White
Write-Host "    1クリック起動: .\start-desktop.bat" -ForegroundColor Gray
Write-Host "    PORT指定起動: .\start-desktop.bat 3002" -ForegroundColor Gray
Write-Host "    開発モード  : npm run dev" -ForegroundColor Gray
Write-Host "    GUI起動     : npm run desktop" -ForegroundColor Gray
Write-Host "    本番ビルド  : npm run build" -ForegroundColor Gray
Write-Host "    配布パッケージ: npm run package:desktop" -ForegroundColor Gray
Write-Host "============================================================" -ForegroundColor Magenta
Write-Host ""
Read-Host "Enterで閉じる"
