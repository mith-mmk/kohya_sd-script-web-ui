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


_DEFAULT_RESOLUTION = {
    "sd1x": 512,
    "sdxl": 1024,
    "flux": 1024,
    "anima": 1024,
}


def generate_dataset_toml(config: dict) -> str:
    dataset_dir = config["datasetDir"]
    work_dir = config["workDir"]
    model_type = config.get("modelType", "sdxl")
    trigger_word = (config.get("triggerWord") or "").strip()
    repeat_count = max(1, int(config.get("repeatCount") or 10))
    preprocess_opts = config.get("preprocessOptions", {}) or {}
    caption_extension = preprocess_opts.get("captionExtension", ".txt")
    resolution = _DEFAULT_RESOLUTION.get(model_type, 1024)
    toml_path = os.path.join(work_dir, "dataset.toml")

    lines = [
        "[[datasets]]",
        f"resolution = {resolution}",
        "batch_size = 1",
        "",
        "  [[datasets.subsets]]",
        f"  image_dir = {json.dumps(dataset_dir)}",
        f"  caption_extension = {json.dumps(caption_extension)}",
        f"  num_repeats = {repeat_count}",
    ]
    if trigger_word:
        lines.append(f"  class_tokens = {json.dumps(trigger_word)}")

    with open(toml_path, "w", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")

    return toml_path


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

    dataset_toml = generate_dataset_toml(config)
    info(f"[phase:train] Generated dataset config: {dataset_toml}")

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
