#!/usr/bin/env bash
set -euo pipefail

# ── カラー出力 ────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'
info()  { echo -e "${CYAN}[INFO]${NC}  $*"; }
ok()    { echo -e "${GREEN}[ OK ]${NC}  $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC}  $*"; }
error() { echo -e "${RED}[ERROR]${NC} $*" >&2; exit 1; }

install_onnx_runtime() {
    info "      ONNX / ONNX Runtime をインストール中..."
    if command -v nvidia-smi &>/dev/null; then
        if $VENV_PIP install onnx onnxruntime-gpu --quiet; then
            ok "onnx / onnxruntime-gpu インストール完了。"
            return
        fi
        warn "onnxruntime-gpu のインストールに失敗したため、CPU 版へフォールバックします。"
    fi

    $VENV_PIP install onnx onnxruntime --quiet
    ok "onnx / onnxruntime インストール完了。"
}

# ── 作業ディレクトリをスクリプトのある場所に固定 ─────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "============================================================"
echo "  Kohya LoRA Builder - インストーラ (Linux / macOS)"
echo "============================================================"
echo

# ─────────────────────────────────────────────────────────────────
# 1. Node.js 確認
# ─────────────────────────────────────────────────────────────────
info "[1/7] Node.js を確認中..."
if ! command -v node &>/dev/null; then
    error "Node.js が見つかりません。https://nodejs.org/ からインストールしてください。"
fi
NODE_VER=$(node -v)
ok "Node.js $NODE_VER を確認しました。"

# ─────────────────────────────────────────────────────────────────
# 2. Python 確認
# ─────────────────────────────────────────────────────────────────
info "[2/7] Python を確認中..."
PYTHON_CMD=""
for cmd in python3.12 python3.11 python3.10 python3 python; do
    if command -v "$cmd" &>/dev/null; then
        PY_VER=$("$cmd" --version 2>&1 | awk '{print $2}')
        PY_MAJOR=$(echo "$PY_VER" | cut -d. -f1)
        PY_MINOR=$(echo "$PY_VER" | cut -d. -f2)
        if [ "$PY_MAJOR" -eq 3 ] && [ "$PY_MINOR" -ge 10 ] && [ "$PY_MINOR" -le 12 ]; then
            PYTHON_CMD="$cmd"
            ok "$cmd (Python $PY_VER) を確認しました。"
            break
        fi
    fi
done
[ -z "$PYTHON_CMD" ] && error "Python 3.10-3.12 が見つかりません。https://www.python.org/ からインストールしてください。"

# ─────────────────────────────────────────────────────────────────
# 3. sd-scripts clone
# ─────────────────────────────────────────────────────────────────
info "[3/7] sd-scripts を確認中..."
if [ -d "$SCRIPT_DIR/sd-scripts" ]; then
    ok "既存の sd-scripts ディレクトリを使用します。"
else
    command -v git &>/dev/null || error "sd-scripts を clone するために Git が必要です。https://git-scm.com/ からインストールしてください。"
    info "      sd-scripts を clone 中..."
    git clone https://github.com/kohya-ss/sd-scripts.git
    ok "sd-scripts を clone しました。"
fi

# ─────────────────────────────────────────────────────────────────
# 4. npm install
# ─────────────────────────────────────────────────────────────────
info "[4/7] Node.js 依存関係をインストール中..."
npm install
ok "完了。"

# ─────────────────────────────────────────────────────────────────
# 5. TypeScript ビルド
# ─────────────────────────────────────────────────────────────────
info "[5/7] TypeScript をビルド中..."
npm run build
ok "完了。"

# ─────────────────────────────────────────────────────────────────
# 6. Python venv セットアップ
# ─────────────────────────────────────────────────────────────────
info "[6/7] Python 仮想環境をセットアップ中..."
if [ -d "venv" ] && [ ! -d ".venv" ]; then
    warn "既存の venv が見つかりました。以後は .venv を使用するため、新規作成します。"
fi

if [ ! -d ".venv" ]; then
    info "      .venv を作成中..."
    $PYTHON_CMD -m venv .venv
fi

# .venv の python を使う
VENV_PYTHON="$SCRIPT_DIR/.venv/bin/python"
VENV_PIP="$SCRIPT_DIR/.venv/bin/pip"

info "      pip をアップグレード中..."
$VENV_PYTHON -m pip install --upgrade pip --quiet

info "      PyTorch / torchvision をインストール中..."
if [ -n "${PYTORCH_INDEX_URL:-}" ]; then
    $VENV_PIP install torch torchvision --index-url "$PYTORCH_INDEX_URL" --quiet
else
    $VENV_PIP install torch torchvision --quiet
fi
ok "PyTorch / torchvision インストール完了。"

install_onnx_runtime

info "      sd-scripts の依存関係をインストール中..."
# requirements.txt 内の -e . は CWD 相対なので sd-scripts ディレクトリで実行する
(cd "$SCRIPT_DIR/sd-scripts" && $VENV_PIP install -r requirements.txt --quiet) && \
    ok "requirements.txt インストール完了。" || {
    warn "requirements.txt の一部でエラーが発生しました。"
    warn "PyTorch は別途インストールが必要な場合があります: https://pytorch.org/get-started/locally/"
}

# ─────────────────────────────────────────────────────────────────
# 7. データディレクトリ作成
# ─────────────────────────────────────────────────────────────────
info "[7/7] データディレクトリを作成中..."
mkdir -p data work
ok "完了。"

# ─────────────────────────────────────────────────────────────────
# .env 生成（存在しない場合のみ）
# ─────────────────────────────────────────────────────────────────
if [ ! -f ".env" ]; then
    info "      .env を生成中..."
    cat > .env <<EOF
# Kohya LoRA Builder 設定
PORT=3001
HOST=127.0.0.1
DB_PATH=${SCRIPT_DIR}/data/kohya.db
SD_SCRIPTS_DIR=${SCRIPT_DIR}/sd-scripts
BRIDGE_DIR=${SCRIPT_DIR}/python/bridge
WORK_BASE=${SCRIPT_DIR}/work
PYTHON_BIN=${SCRIPT_DIR}/.venv/bin/python
EOF
    ok ".env を作成しました。"
fi

echo
echo "============================================================"
echo "  インストール完了！"
echo
echo "  起動方法:"
echo "    開発モード  : npm run dev"
echo "    本番ビルド  : npm run build"
echo "    デスクトップ: cd apps/desktop && npm run dev"
echo "============================================================"
