"""
runner.py
Entry point called by Node.js JobQueue.
Usage: python runner.py --config <job_config.json>

Emits JSON-line events to stdout for the Node.js server to consume.
"""

from __future__ import annotations
import argparse
import json
import os
import subprocess
import sys
from pathlib import Path

# Ensure bridge dir is importable regardless of CWD
_bridge_dir = Path(__file__).parent
if str(_bridge_dir) not in sys.path:
    sys.path.insert(0, str(_bridge_dir))

from event_emitter import info, warn, error, parse_and_emit_training_line, exit_event
from preprocessor import run_preprocessing
from command_builder import build_train_command


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--config", required=True, help="Path to job_config.json")
    args = parser.parse_args()

    config_path = Path(args.config)
    if not config_path.exists():
        error(f"Config file not found: {config_path}")
        exit_event(1, "Config not found")
        sys.exit(1)

    with open(config_path, encoding="utf-8") as f:
        config: dict = json.load(f)

    job_id: str = config.get("jobId", "unknown")
    sd_dir: str = config["sdScriptsDir"]

    # ── Phase 1: Preprocessing ────────────────────────────────────────────────
    info(f"[phase:preprocess] Starting preprocessing for job {job_id}")
    try:
        ok = run_preprocessing(config)
    except Exception as exc:
        error(f"[phase:preprocess] Unexpected error: {exc}")
        exit_event(1, str(exc))
        sys.exit(1)

    if not ok:
        exit_event(1, "Preprocessing failed")
        sys.exit(1)

    info("[phase:preprocess] Preprocessing complete")

    # ── Phase 2: Training ─────────────────────────────────────────────────────
    info("[phase:train] Building training command")
    try:
        cmd = build_train_command(config, sd_dir)
    except (ValueError, FileNotFoundError) as exc:
        error(f"[phase:train] Command build error: {exc}")
        exit_event(1, str(exc))
        sys.exit(1)

    info(f"[phase:train] Command: {' '.join(cmd)}")

    proc = subprocess.Popen(
        cmd,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        encoding="utf-8",
        errors="replace",
        cwd=sd_dir,
        env={**os.environ},
    )

    assert proc.stdout
    for line in proc.stdout:
        parse_and_emit_training_line(line)

    proc.wait()

    if proc.returncode == 0:
        info("[phase:train] Training completed successfully")
        exit_event(0, "Training complete")
    else:
        error(f"[phase:train] Training exited with code {proc.returncode}")
        exit_event(proc.returncode, f"Training failed with code {proc.returncode}")
        sys.exit(proc.returncode)


if __name__ == "__main__":
    main()
