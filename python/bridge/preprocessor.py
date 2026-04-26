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


_PREPARE_BUCKETS_SUPPORTED = {"sd1x", "sdxl"}
_UTF8_ENV = {"PYTHONIOENCODING": "utf-8", "PYTHONUTF8": "1"}


def _subset_work_key(index: int, image_dir: str) -> str:
    base_name = Path(image_dir).name or f"subset_{index + 1}"
    safe_name = "".join(ch if ch.isalnum() else "_" for ch in base_name).strip("_")
    if not safe_name:
        safe_name = f"subset_{index + 1}"
    return f"{index + 1:02d}_{safe_name}"


def _resolve_dataset_subsets(config: dict[str, Any]) -> list[dict[str, Any]]:
    dataset_subsets: list[dict[str, Any]] = []
    for index, raw_subset in enumerate(config.get("datasetSubsets") or []):
        image_dir = str(raw_subset.get("imageDir") or "").strip()
        if not image_dir:
            continue
        subset_name = Path(image_dir).name or f"subset_{index + 1}"
        dataset_subsets.append(
            {
                "imageDir": image_dir,
                "triggerWord": str(raw_subset.get("triggerWord") or "").strip(),
                "repeatCount": max(1, int(raw_subset.get("repeatCount") or 10)),
                "workKey": _subset_work_key(index, image_dir),
                "label": f"{index + 1}:{subset_name}",
            }
        )

    if dataset_subsets:
        return dataset_subsets

    dataset_dir = str(config.get("datasetDir") or "").strip()
    if not dataset_dir:
        return []

    return [
        {
            "imageDir": dataset_dir,
            "triggerWord": str(config.get("triggerWord") or "").strip(),
            "repeatCount": max(1, int(config.get("repeatCount") or 10)),
            "workKey": _subset_work_key(0, dataset_dir),
            "label": f"1:{Path(dataset_dir).name or 'subset_1'}",
        }
    ]


def _get_effective_subset_dir(
    work_dir: str, subset: dict[str, Any], opts: dict[str, Any]
) -> str:
    if opts.get("runResize", False):
        return os.path.join(work_dir, "resized", subset["workKey"])
    return subset["imageDir"]


def run_preprocessing(config: dict[str, Any]) -> bool:
    """
    Execute the full preprocessing pipeline based on preprocessOptions.
    Returns True on success, False on failure.
    """
    opts: dict[str, Any] = config.get("preprocessOptions", {})

    if opts.get("skipPreprocessing", False):
        info("Preprocessing skipped by user (skipPreprocessing=true)")
        return True

    work_dir: str = config["workDir"]
    sd_dir: str = config["sdScriptsDir"]
    python = sys.executable
    dataset_subsets = _resolve_dataset_subsets(config)
    if not dataset_subsets:
        error("[preprocess] No dataset subsets configured")
        return False

    steps = []
    run_resize = opts.get("runResize", False)
    run_wd14 = opts.get("runWd14Tagger", True)
    captioning = opts.get("runCaptioning", "none")
    model_type = str(config.get("modelType") or "")

    if (
        opts.get("runPrepareBuckets", False)
        and model_type not in _PREPARE_BUCKETS_SUPPORTED
    ):
        error(
            f"[preprocess] runPrepareBuckets is not supported for modelType={model_type or 'unknown'}"
        )
        return False

    # Step 1: Resize images
    if run_resize:
        for subset in dataset_subsets:
            out_dir = os.path.join(work_dir, "resized", subset["workKey"])
            steps.append(
                (
                    f"resize:{subset['label']}",
                    _resize_step(python, sd_dir, subset["imageDir"], out_dir, opts),
                )
            )

    for subset in dataset_subsets:
        effective_dir = _get_effective_subset_dir(work_dir, subset, opts)

        # Step 2: WD14 tagger
        if run_wd14:
            steps.append(
                (
                    f"wd14-tagger:{subset['label']}",
                    _wd14_step(python, sd_dir, effective_dir, opts),
                )
            )

        # Step 3: Captioning
        if captioning == "blip":
            steps.append(
                (
                    f"blip-caption:{subset['label']}",
                    _blip_step(python, sd_dir, effective_dir, opts),
                )
            )
        elif captioning == "git":
            steps.append(
                (
                    f"git-caption:{subset['label']}",
                    _git_step(python, sd_dir, effective_dir, opts),
                )
            )

        # Step 4: Merge captions/tags to metadata
        if run_wd14 or captioning != "none":
            subset_meta_dir = os.path.join(work_dir, "metadata", subset["workKey"])
            os.makedirs(subset_meta_dir, exist_ok=True)
            meta_path = os.path.join(subset_meta_dir, "metadata.json")
            if captioning != "none":
                meta_capt = os.path.join(subset_meta_dir, "meta_capt.json")
                steps.append(
                    (
                        f"merge-captions:{subset['label']}",
                        _merge_captions_step(
                            python, sd_dir, effective_dir, meta_capt, opts
                        ),
                    )
                )
                steps.append(
                    (
                        f"merge-tags:{subset['label']}",
                        _merge_tags_step(
                            python, sd_dir, effective_dir, meta_path, meta_capt, opts
                        ),
                    )
                )
            else:
                steps.append(
                    (
                        f"merge-tags:{subset['label']}",
                        _merge_tags_only_step(
                            python, sd_dir, effective_dir, meta_path, opts
                        ),
                    )
                )

            # Step 5: Clean
            meta_clean = os.path.join(subset_meta_dir, "meta_clean.json")
            steps.append(
                (
                    f"clean-metadata:{subset['label']}",
                    _clean_step(python, sd_dir, meta_path, meta_clean),
                )
            )

            # Step 6: Prepare buckets/latents
            if opts.get("runPrepareBuckets", False):
                steps.append(
                    (
                        f"prepare-buckets:{subset['label']}",
                        _buckets_step(
                            python,
                            sd_dir,
                            effective_dir,
                            meta_clean,
                            os.path.join(subset_meta_dir, "meta_final.json"),
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
    env = {**os.environ, **_UTF8_ENV}
    if cwd:
        existing_pythonpath = env.get("PYTHONPATH")
        env["PYTHONPATH"] = (
            f"{cwd}{os.pathsep}{existing_pythonpath}" if existing_pythonpath else cwd
        )

    proc = subprocess.Popen(
        cmd,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        encoding="utf-8",
        errors="replace",
        cwd=cwd,
        env=env,
    )
    assert proc.stdout
    for line in proc.stdout:
        parse_and_emit_training_line(f"[{step_name}] {line.rstrip()}")
    proc.wait()
    return proc.returncode == 0


def _resize_step(
    python: str, sd_dir: str, src: str, out_dir: str, opts: dict
) -> list[str]:
    os.makedirs(out_dir, exist_ok=True)
    return [
        python,
        os.path.join(sd_dir, "tools", "resize_images_to_resolution.py"),
        src,
        out_dir,
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
