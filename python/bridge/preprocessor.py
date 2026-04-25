"""
preprocessor.py
Runs the sd-scripts finetune scripts in order.
Each step emits JSON-line events via event_emitter.
"""

from __future__ import annotations
import os
import sys
import subprocess
from pathlib import Path
from typing import Any

from event_emitter import info, warn, error, parse_and_emit_training_line


def run_preprocessing(config: dict[str, Any]) -> bool:
    """
    Execute the full preprocessing pipeline based on preprocessOptions.
    Returns True on success, False on failure.
    """
    opts: dict[str, Any] = config.get("preprocessOptions", {})
    dataset_dir: str = config["datasetDir"]
    work_dir: str = config["workDir"]
    sd_dir: str = config["sdScriptsDir"]
    python = sys.executable

    steps = []

    # Step 1: Resize images
    if opts.get("runResize", False):
        steps.append(
            ("resize", _resize_step(python, sd_dir, dataset_dir, work_dir, opts))
        )

    effective_dir = (
        os.path.join(work_dir, "resized") if opts.get("runResize") else dataset_dir
    )

    # Step 2: WD14 tagger
    if opts.get("runWd14Tagger", True):
        steps.append(("wd14-tagger", _wd14_step(python, sd_dir, effective_dir, opts)))

    # Step 3: Captioning
    captioning = opts.get("runCaptioning", "none")
    if captioning == "blip":
        steps.append(("blip-caption", _blip_step(python, sd_dir, effective_dir, opts)))
    elif captioning == "git":
        steps.append(("git-caption", _git_step(python, sd_dir, effective_dir, opts)))

    # Step 4: Merge captions/tags to metadata
    meta_path = os.path.join(work_dir, "metadata.json")
    if opts.get("runWd14Tagger") or captioning != "none":
        if captioning != "none":
            meta_capt = os.path.join(work_dir, "meta_capt.json")
            steps.append(
                (
                    "merge-captions",
                    _merge_captions_step(
                        python, sd_dir, effective_dir, meta_capt, opts
                    ),
                )
            )
            steps.append(
                (
                    "merge-tags",
                    _merge_tags_step(
                        python, sd_dir, effective_dir, meta_path, meta_capt, opts
                    ),
                )
            )
        else:
            # Tags only
            steps.append(
                (
                    "merge-tags",
                    _merge_tags_only_step(
                        python, sd_dir, effective_dir, meta_path, opts
                    ),
                )
            )

        # Step 5: Clean
        meta_clean = os.path.join(work_dir, "meta_clean.json")
        steps.append(
            ("clean-metadata", _clean_step(python, sd_dir, meta_path, meta_clean))
        )

        # Step 6: Prepare buckets/latents
        if opts.get("runPrepareBuckets", False):
            steps.append(
                (
                    "prepare-buckets",
                    _buckets_step(
                        python,
                        sd_dir,
                        effective_dir,
                        meta_clean,
                        os.path.join(work_dir, "meta_final.json"),
                        config["baseModelPath"],
                        opts,
                    ),
                )
            )

    if not steps:
        info("Preprocessing skipped (all steps disabled)")
        return True

    for name, cmd in steps:
        info(f"[preprocess] Starting: {name}")
        # Run all finetune scripts from sd_dir so `import library.*` resolves correctly
        ok = _run_cmd(name, cmd, cwd=sd_dir)
        if not ok:
            error(f"[preprocess] Failed at step: {name}")
            return False
        info(f"[preprocess] Done: {name}")

    return True


def _run_cmd(step_name: str, cmd: list[str], cwd: str | None = None) -> bool:
    proc = subprocess.Popen(
        cmd,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        encoding="utf-8",
        errors="replace",
        cwd=cwd,
    )
    assert proc.stdout
    for line in proc.stdout:
        parse_and_emit_training_line(f"[{step_name}] {line.rstrip()}")
    proc.wait()
    return proc.returncode == 0


def _resize_step(
    python: str, sd_dir: str, src: str, work_dir: str, opts: dict
) -> list[str]:
    out = os.path.join(work_dir, "resized")
    os.makedirs(out, exist_ok=True)
    return [
        python,
        os.path.join(sd_dir, "tools", "resize_images_to_resolution.py"),
        src,
        out,
        "--max_resolution",
        opts.get("maxResolution", "1024x1024"),
        "--divisible_by",
        "8",
        "--copy_associated_files",
    ]


def _wd14_step(python: str, sd_dir: str, img_dir: str, opts: dict) -> list[str]:
    return [
        python,
        os.path.join(sd_dir, "finetune", "tag_images_by_wd14_tagger.py"),
        "--onnx",
        "--batch_size",
        str(opts.get("wd14BatchSize", 8)),
        "--thresh",
        str(opts.get("wd14Threshold", 0.35)),
        "--recursive",
        img_dir,
    ]


def _blip_step(python: str, sd_dir: str, img_dir: str, opts: dict) -> list[str]:
    return [
        python,
        os.path.join(sd_dir, "finetune", "make_captions.py"),
        "--batch_size",
        "4",
        "--recursive",
        img_dir,
    ]


def _git_step(python: str, sd_dir: str, img_dir: str, opts: dict) -> list[str]:
    return [
        python,
        os.path.join(sd_dir, "finetune", "make_captions_by_git.py"),
        "--batch_size",
        "4",
        "--recursive",
        img_dir,
    ]


def _merge_captions_step(
    python: str, sd_dir: str, img_dir: str, out_json: str, opts: dict
) -> list[str]:
    return [
        python,
        os.path.join(sd_dir, "finetune", "merge_captions_to_metadata.py"),
        img_dir,
        out_json,
        "--caption_extension",
        opts.get("captionExtension", ".txt"),
        "--full_path",
        "--recursive",
    ]


def _merge_tags_step(
    python: str, sd_dir: str, img_dir: str, out_json: str, in_json: str, opts: dict
) -> list[str]:
    return [
        python,
        os.path.join(sd_dir, "finetune", "merge_dd_tags_to_metadata.py"),
        img_dir,
        out_json,
        "--in_json",
        in_json,
        "--caption_extension",
        ".txt",
        "--full_path",
        "--recursive",
    ]


def _merge_tags_only_step(
    python: str, sd_dir: str, img_dir: str, out_json: str, opts: dict
) -> list[str]:
    return [
        python,
        os.path.join(sd_dir, "finetune", "merge_dd_tags_to_metadata.py"),
        img_dir,
        out_json,
        "--caption_extension",
        ".txt",
        "--full_path",
        "--recursive",
    ]


def _clean_step(python: str, sd_dir: str, in_json: str, out_json: str) -> list[str]:
    return [
        python,
        os.path.join(sd_dir, "finetune", "clean_captions_and_tags.py"),
        in_json,
        out_json,
    ]


def _buckets_step(
    python: str,
    sd_dir: str,
    img_dir: str,
    in_json: str,
    out_json: str,
    model_path: str,
    opts: dict,
) -> list[str]:
    return [
        python,
        os.path.join(sd_dir, "finetune", "prepare_buckets_latents.py"),
        img_dir,
        in_json,
        out_json,
        model_path,
        "--max_resolution",
        opts.get("maxResolution", "1024,1024").replace("x", ","),
        "--bucket_reso_steps",
        str(opts.get("bucketResoSteps", 64)),
        "--mixed_precision",
        "fp16",
        "--batch_size",
        "4",
        "--full_path",
        "--recursive",
    ]
