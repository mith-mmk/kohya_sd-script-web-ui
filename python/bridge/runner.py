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
from typing import Any

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

_UTF8_ENV = {"PYTHONIOENCODING": "utf-8", "PYTHONUTF8": "1"}
_FATAL_TRAINING_MARKERS = ("No data found.", "画像がありません")
_IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp", ".bmp", ".avif"}
_EDITABLE_PROMPT_EXTENSION = ".prompt.txt"
_TRAINING_PROMPT_EXTENSION = ".train.txt"
_RELATIVE_DATASET_PATH_ERROR = (
    "Dataset subset directory must be an absolute path: {path}. "
    "The browser folder picker may have returned only the folder name. "
    "Use the desktop app or enter an absolute path manually."
)


def _subset_work_key(index: int, image_dir: str) -> str:
    base_name = Path(image_dir).name or f"subset_{index + 1}"
    safe_name = "".join(ch if ch.isalnum() else "_" for ch in base_name).strip("_")
    if not safe_name:
        safe_name = f"subset_{index + 1}"
    return f"{index + 1:02d}_{safe_name}"


def _require_absolute_dataset_dir(image_dir: str) -> str:
    if not os.path.isabs(image_dir):
        raise ValueError(_RELATIVE_DATASET_PATH_ERROR.format(path=image_dir))
    return image_dir


def _resolve_dataset_subsets(config: dict[str, Any]) -> list[dict[str, Any]]:
    dataset_subsets: list[dict[str, Any]] = []
    for index, raw_subset in enumerate(config.get("datasetSubsets") or []):
        image_dir = str(raw_subset.get("imageDir") or "").strip()
        if not image_dir:
            continue
        dataset_subsets.append(
            {
                "imageDir": _require_absolute_dataset_dir(image_dir),
                "triggerWord": str(raw_subset.get("triggerWord") or "").strip(),
                "repeatCount": max(1, int(raw_subset.get("repeatCount") or 10)),
                "workKey": _subset_work_key(index, image_dir),
            }
        )

    if dataset_subsets:
        return dataset_subsets

    dataset_dir = str(config.get("datasetDir") or "").strip()
    if not dataset_dir:
        return []

    return [
        {
            "imageDir": _require_absolute_dataset_dir(dataset_dir),
            "triggerWord": str(config.get("triggerWord") or "").strip(),
            "repeatCount": max(1, int(config.get("repeatCount") or 10)),
            "workKey": _subset_work_key(0, dataset_dir),
        }
    ]


def _get_effective_subset_dir(config: dict[str, Any], subset: dict[str, Any]) -> str:
    preprocess_opts = config.get("preprocessOptions", {}) or {}
    managed_dir = os.path.join(
        config["workDir"],
        (
            "resized"
            if preprocess_opts.get("runResize", False)
            and not preprocess_opts.get("skipPreprocessing", False)
            else "prepared"
        ),
        subset["workKey"],
    )
    return managed_dir if os.path.isdir(managed_dir) else subset["imageDir"]


def _iter_image_files(root_dir: str) -> list[Path]:
    root = Path(root_dir)
    if not root.exists():
        return []
    return sorted(
        path
        for path in root.rglob("*")
        if path.is_file() and path.suffix.lower() in _IMAGE_EXTENSIONS
    )


def _read_prompt_text(prompt_path: Path) -> str:
    if not prompt_path.is_file():
        return ""
    return prompt_path.read_text(encoding="utf-8", errors="replace").strip()


def _strip_trigger_word(prompt_text: str, trigger_word: str) -> str:
    if not prompt_text or not trigger_word:
        return prompt_text.strip()

    trigger_norm = trigger_word.strip().casefold()
    tokens = [token.strip() for token in prompt_text.split(",")]
    filtered_tokens = [
        token for token in tokens if token and token.casefold() != trigger_norm
    ]
    return ", ".join(filtered_tokens)


def _build_training_prompt(prompt_text: str, trigger_word: str) -> str:
    prompt_body = _strip_trigger_word(prompt_text, trigger_word)
    parts = []
    if trigger_word.strip():
        parts.append(trigger_word.strip())
    if prompt_body:
        parts.append(prompt_body)
    return ", ".join(parts)


def _materialize_training_captions(
    config: dict[str, Any], subset: dict[str, Any]
) -> int:
    effective_dir = _get_effective_subset_dir(config, subset)
    created_count = 0
    for image_path in _iter_image_files(effective_dir):
        prompt_path = image_path.with_suffix(_EDITABLE_PROMPT_EXTENSION)
        training_path = image_path.with_suffix(_TRAINING_PROMPT_EXTENSION)
        training_prompt = _build_training_prompt(
            _read_prompt_text(prompt_path), subset.get("triggerWord", "")
        )
        training_path.write_text(
            f"{training_prompt}\n" if training_prompt else "", encoding="utf-8"
        )
        created_count += 1
    return created_count


def generate_dataset_toml(config: dict[str, Any]) -> str:
    dataset_subsets = _resolve_dataset_subsets(config)
    if not dataset_subsets:
        raise ValueError("No dataset subsets configured")

    work_dir = config["workDir"]
    model_type = config.get("modelType", "sdxl")
    params = config.get("params", {}) or {}
    resolution = _DEFAULT_RESOLUTION.get(model_type, 1024)
    toml_path = os.path.join(work_dir, "dataset.toml")

    lines = [
        "[[datasets]]",
        f"resolution = {resolution}",
        f"batch_size = {max(1, int(params.get('batchSize') or 1))}",
    ]
    for subset in dataset_subsets:
        materialized_count = _materialize_training_captions(config, subset)
        info(
            f"[phase:train] Materialized training captions: {subset['workKey']} ({materialized_count} files)"
        )
        lines += [
            "",
            "  [[datasets.subsets]]",
            f"  image_dir = {json.dumps(_get_effective_subset_dir(config, subset))}",
            f"  caption_extension = {json.dumps(_TRAINING_PROMPT_EXTENSION)}",
            f"  num_repeats = {subset['repeatCount']}",
        ]

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
    resume_from_step = config.get("resumeFromStep")
    if config.get("resume") and resume_from_step == "train":
        info("[phase:preprocess] Skipping preprocessing for training resume")
    else:
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
        dataset_toml = generate_dataset_toml(config)
        info(f"[phase:train] Generated dataset config: {dataset_toml}")
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
        env={**os.environ, **_UTF8_ENV},
    )

    fatal_training_error: str | None = None
    assert proc.stdout
    for line in proc.stdout:
        parse_and_emit_training_line(line)
        if fatal_training_error is None and any(
            marker in line for marker in _FATAL_TRAINING_MARKERS
        ):
            fatal_training_error = line.strip()

    proc.wait()

    if proc.returncode == 0 and fatal_training_error is None:
        info("[phase:train] Training completed successfully")
        exit_event(0, "Training complete")
    else:
        if fatal_training_error is not None:
            error(
                f"[phase:train] Fatal training error detected: {fatal_training_error}"
            )
            exit_event(1, fatal_training_error)
            sys.exit(1)
        error(f"[phase:train] Training exited with code {proc.returncode}")
        exit_event(proc.returncode, f"Training failed with code {proc.returncode}")
        sys.exit(proc.returncode)


if __name__ == "__main__":
    main()
