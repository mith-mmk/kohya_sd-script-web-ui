@echo off
setlocal EnableDelayedExpansion
chcp 65001 >nul

:: ── 引数解析 --auto-python / --python-ver 3.12 ──────────────────
set AUTO_PYTHON=0
set PYTHON_VER=3.12
:parse_args
if "%~1"=="--auto-python"  ( set AUTO_PYTHON=1 & shift & goto parse_args )
if "%~1"=="--python-ver"   ( set PYTHON_VER=%~2 & shift & shift & goto parse_args )

echo ============================================================
echo  Kohya LoRA Builder - Windows インストーラ
echo ============================================================
echo.

:: ── 作業ディレクトリをスクリプトのある場所に固定 ─────────────────
cd /d "%~dp0"

:: ────────────────────────────────────────────────────────────────
:: 1. Node.js 確認
:: ────────────────────────────────────────────────────────────────
echo [1/6] Node.js を確認中...
where node >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Node.js が見つかりません。
    echo         https://nodejs.org/ から LTS 版をインストールしてください。
    pause & exit /b 1
)
for /f "tokens=1" %%v in ('node -v') do set NODE_VER=%%v
echo       Node.js %NODE_VER% を確認しました。

:: npm バージョン確認（8以上必要）
for /f "tokens=1" %%v in ('npm -v') do set NPM_VER=%%v
echo       npm %NPM_VER% を確認しました。

:: ────────────────────────────────────────────────────────────────
:: 2. Python 確認
:: ────────────────────────────────────────────────────────────────
echo.
echo [2/6] Python を確認中...
set PYTHON_CMD=

:: まずローカル .python\ を確認
if exist ".python\python.exe" (
    echo       ローカル Python (.python\python.exe) を使用します。
    set PYTHON_CMD=.python\python.exe
    goto python_ok
)

for %%c in ("py -3.10" "py -3.11" "py -3.12" python python3 py) do (
    if not defined PYTHON_CMD (
        for /f "tokens=2" %%v in ('%%~c --version 2^>^&1') do (
            echo       %%~c ^(Python %%v^) を確認しました。
            set PYTHON_CMD=%%~c
        )
    )
)
if not defined PYTHON_CMD (
    if "%AUTO_PYTHON%"=="1" (
        echo [INFO] Python 3.10-3.12 が見つかりません。自動取得します...
        powershell -NoProfile -ExecutionPolicy Bypass -Command ^
          "& { $url = @{'3.12'='https://github.com/indygreg/python-build-standalone/releases/download/20241002/cpython-3.12.7+20241002-x86_64-pc-windows-msvc-install_only.tar.gz';'3.11'='https://github.com/indygreg/python-build-standalone/releases/download/20241002/cpython-3.11.10+20241002-x86_64-pc-windows-msvc-install_only.tar.gz';'3.10'='https://github.com/indygreg/python-build-standalone/releases/download/20241002/cpython-3.10.15+20241002-x86_64-pc-windows-msvc-install_only.tar.gz'}['%PYTHON_VER%']; $tmp='%TEMP%\py-standalone.tar.gz'; [Net.ServicePointManager]::SecurityProtocol='Tls12'; Write-Host '  ダウンロード中...'; Invoke-WebRequest $url -OutFile $tmp -UseBasicParsing; $tmpDir='%TEMP%\py-standalone'; if(Test-Path $tmpDir){Remove-Item $tmpDir -Recurse -Force}; New-Item -ItemType Directory $tmpDir -Force|Out-Null; tar -xf $tmp -C $tmpDir; $src=Join-Path $tmpDir 'python'; if(Test-Path '.python'){Remove-Item '.python' -Recurse -Force}; Move-Item $src '.python'; Remove-Item $tmp -Force -ErrorAction SilentlyContinue; Remove-Item $tmpDir -Recurse -Force -ErrorAction SilentlyContinue; Write-Host '  完了。' }"
        if errorlevel 1 (
            echo [ERROR] Python の自動取得に失敗しました。
            pause & exit /b 1
        )
        set PYTHON_CMD=.python\python.exe
        goto python_ok
    )
    echo [ERROR] Python 3.10-3.12 が見つかりません。
    echo         オプション 1: https://www.python.org/ から 3.10/3.11/3.12 をインストール後に再実行
    echo         オプション 2: install.bat --auto-python          (3.12 を自動取得)
    echo         オプション 3: install.bat --auto-python --python-ver 3.10
    pause & exit /b 1
)

for /f "tokens=1,2 delims=." %%a in ('%PYTHON_CMD% -c "import sys;print(f""{sys.version_info[0]}.{sys.version_info[1]}"")"') do (
    set PY_MAJOR=%%a
    set PY_MINOR=%%b
)
if not "%PY_MAJOR%"=="3" (
    echo [ERROR] Python 3.10-3.12 が必要です。現在: %PY_MAJOR%.%PY_MINOR%
    pause & exit /b 1
)
if %PY_MINOR% LSS 10 (
    echo [ERROR] Python 3.10-3.12 が必要です。現在: %PY_MAJOR%.%PY_MINOR%
    pause & exit /b 1
)
if %PY_MINOR% GTR 12 (
    echo [ERROR] Python 3.10-3.12 が必要です。現在: %PY_MAJOR%.%PY_MINOR%
    echo         オプション: install.bat --auto-python  (3.12 を自動取得)
    pause & exit /b 1
)

:python_ok

:: ────────────────────────────────────────────────────────────────
:: 3. npm install（Node.js 依存関係）
:: ────────────────────────────────────────────────────────────────
echo.
echo [3/6] Node.js 依存関係をインストール中...
call npm install
if errorlevel 1 (
    echo [ERROR] npm install に失敗しました。
    pause & exit /b 1
)
echo       完了。

:: ────────────────────────────────────────────────────────────────
:: 4. TypeScript ビルド
:: ────────────────────────────────────────────────────────────────
echo.
echo [4/6] TypeScript をビルド中...
call npm run build
if errorlevel 1 (
    echo [ERROR] ビルドに失敗しました。
    pause & exit /b 1
)
echo       完了。

:: ────────────────────────────────────────────────────────────────
:: 5. Python venv のセットアップ
:: ────────────────────────────────────────────────────────────────
echo.
echo [5/6] Python 仮想環境をセットアップ中...
if exist "venv\" if not exist ".venv\" (
    echo [WARN] 既存の venv が見つかりました。以後は .venv を使用するため、新規作成します。
)
if not exist ".venv\" (
    echo       .venv を作成中...
    %PYTHON_CMD% -m venv .venv
    if errorlevel 1 (
        echo [ERROR] .venv の作成に失敗しました。
        pause & exit /b 1
    )
) else (
    echo       既存の .venv を使用します。
)

echo       pip をアップグレード中...
call .venv\Scripts\python.exe -m pip install --upgrade pip --quiet

echo       sd-scripts の依存関係をインストール中...
:: requirements.txt 内の -e . は CWD 相対なので sd-scripts ディレクトリで実行する
pushd "%~dp0sd-scripts"
call "%~dp0.venv\Scripts\pip.exe" install -r requirements.txt --quiet
if errorlevel 1 (
    echo [WARN] requirements.txt の一部パッケージでエラーが発生しました。
    echo        PyTorch は別途インストールが必要な場合があります。
    echo        https://pytorch.org/get-started/locally/
)
popd

:: ────────────────────────────────────────────────────────────────
:: 6. データディレクトリ作成
:: ────────────────────────────────────────────────────────────────
echo.
echo [6/6] データディレクトリを作成中...
if not exist "data\" mkdir data
if not exist "work\" mkdir work
echo       完了。

:: ────────────────────────────────────────────────────────────────
:: .env 生成（存在しない場合のみ）
:: ────────────────────────────────────────────────────────────────
if not exist ".env" (
    echo.
    echo       .env を生成中...
    (
        echo # Kohya LoRA Builder 設定
        echo PORT=3001
        echo HOST=127.0.0.1
        echo DB_PATH=%~dp0data\kohya.db
        echo SD_SCRIPTS_DIR=%~dp0sd-scripts
        echo BRIDGE_DIR=%~dp0python\bridge
        echo WORK_BASE=%~dp0work
        echo PYTHON_BIN=%~dp0.venv\Scripts\python.exe
    ) > .env
    echo       .env を作成しました。
)

echo.
echo ============================================================
echo  インストール完了！
echo.
echo  起動方法:
echo    開発モード  : npm run dev
echo    本番ビルド  : npm run build
echo    デスクトップ: cd apps\desktop ^&^& npm run dev
echo ============================================================
echo.
pause
