"""
preprocessor.py
Runs the sd-scripts finetune scripts in order.
Each step emits JSON-line events via event_emitter.
"""

from __future__ import annotations
import json
import os
import shutil
import sys
import subprocess
from pathlib import Path
from typing import Any

from event_emitter import info, warn, error, parse_and_emit_training_line


_PREPARE_BUCKETS_SUPPORTED = {"sd1x", "sdxl"}
_UTF8_ENV = {"PYTHONIOENCODING": "utf-8", "PYTHONUTF8": "1"}
_IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp", ".bmp", ".avif"}
_RAW_CAPTION_EXTENSION = ".caption"
_RAW_TAG_EXTENSION = ".wd14.txt"
_EDITABLE_PROMPT_EXTENSION = ".prompt.txt"
_TEXT_SIDECAR_SUFFIXES = (
    ".txt",
    ".caption",
    ".wd14.txt",
    ".prompt.txt",
    ".train.txt",
)
_TEXT_DECODE_ENCODINGS = ("utf-8-sig", "utf-8", "cp932")
_RELATIVE_DATASET_PATH_ERROR = (
    "Dataset subset directory must be an absolute path: {path}. "
    "The browser folder picker may have returned only the folder name. "
    "Use the desktop app or enter an absolute path manually."
)
_WD14_DEPENDENCY_ERROR = (
    "[preprocess] WD14 tagger requires Python modules that are not installed: {modules}. "
    "Install `huggingface_hub`, `onnx` and `onnxruntime-gpu` (or `onnxruntime` for CPU-only environments), "
    "then retry preprocessing."
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
        subset_name = Path(image_dir).name or f"subset_{index + 1}"
        dataset_subsets.append(
            {
                "imageDir": _require_absolute_dataset_dir(image_dir),
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
            "imageDir": _require_absolute_dataset_dir(dataset_dir),
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
    if opts.get("normalizeImages", True):
        return os.path.join(work_dir, "normalized", subset["workKey"])
    return os.path.join(work_dir, "prepared", subset["workKey"])


def _get_normalized_subset_dir(work_dir: str, subset: dict[str, Any]) -> str:
    return os.path.join(work_dir, "normalized", subset["workKey"])


def _get_shared_work_dir(work_dir: str) -> str:
    shared_dir = os.path.join(os.path.dirname(work_dir), "_shared")
    os.makedirs(shared_dir, exist_ok=True)
    return shared_dir


def _get_wd14_model_dir(work_dir: str) -> str:
    model_dir = os.path.join(_get_shared_work_dir(work_dir), "wd14_tagger_model")
    os.makedirs(model_dir, exist_ok=True)
    return model_dir


def _get_caption_extension(opts: dict[str, Any]) -> str:
    extension = str(opts.get("captionExtension") or ".txt").strip()
    if not extension:
        return ".txt"
    return extension if extension.startswith(".") else f".{extension}"


def _iter_files(root_dir: str) -> list[Path]:
    root = Path(root_dir)
    if not root.exists():
        return []
    return sorted(path for path in root.rglob("*") if path.is_file())


def _iter_image_files(root_dir: str) -> list[Path]:
    return [
        path
        for path in _iter_files(root_dir)
        if path.suffix.lower() in _IMAGE_EXTENSIONS
    ]


def _link_or_copy_file(src: Path, dst: Path) -> None:
    dst.parent.mkdir(parents=True, exist_ok=True)
    if dst.exists():
        return

    if _is_text_sidecar(src):
        _copy_text_sidecar_as_utf8(src, dst)
        return

    try:
        os.link(src, dst)
    except OSError:
        shutil.copy2(src, dst)


def _is_text_sidecar(path: Path) -> bool:
    lower_name = path.name.lower()
    return any(lower_name.endswith(suffix) for suffix in _TEXT_SIDECAR_SUFFIXES)


def _read_text_sidecar_bytes(src: Path) -> tuple[str, str]:
    data = src.read_bytes()
    for encoding in _TEXT_DECODE_ENCODINGS:
        try:
            return data.decode(encoding), encoding
        except UnicodeDecodeError:
            continue
    return data.decode("utf-8", errors="replace"), "utf-8-replace"


def _copy_text_sidecar_as_utf8(src: Path, dst: Path) -> None:
    text, _encoding = _read_text_sidecar_bytes(src)
    dst.write_text(text, encoding="utf-8", newline="")


def _prepare_effective_subset_dir(src_dir: str, dst_dir: str) -> int:
    src_root = Path(src_dir)
    dst_root = Path(dst_dir)
    dst_root.mkdir(parents=True, exist_ok=True)
    copied_files = 0

    for src_path in _iter_files(src_dir):
        rel_path = src_path.relative_to(src_root)
        _link_or_copy_file(src_path, dst_root / rel_path)
        copied_files += 1

    return copied_files


def _normalize_subset_images(src_dir: str, dst_dir: str, normalized_format: str) -> int:
    src_root = Path(src_dir)
    dst_root = Path(dst_dir)
    dst_root.mkdir(parents=True, exist_ok=True)
    normalized_count = 0
    normalized_format = normalized_format.lower().strip()

    if normalized_format == "copy":
        _prepare_effective_subset_dir(src_dir, dst_dir)
        return len(_iter_image_files(dst_dir))

    try:
        from PIL import Image
    except ImportError as exc:
        raise RuntimeError("Image normalization to png/jpg/webp requires Pillow") from exc

    extension = ".jpg" if normalized_format == "jpeg" else f".{normalized_format}"
    if extension not in {".png", ".jpg", ".webp"}:
        raise ValueError(f"Unsupported normalized image format: {normalized_format}")

    for src_path in _iter_files(src_dir):
        rel_path = src_path.relative_to(src_root)
        dst_path = dst_root / rel_path
        if src_path.suffix.lower() in _IMAGE_EXTENSIONS:
            dst_path = dst_path.with_suffix(extension)
            dst_path.parent.mkdir(parents=True, exist_ok=True)
            with Image.open(src_path) as image:
                if extension == ".jpg" and image.mode in {"RGBA", "P"}:
                    image = image.convert("RGB")
                image.save(dst_path)
        else:
            _link_or_copy_file(src_path, dst_path)
        if _is_text_sidecar(dst_path):
            continue
        if dst_path.suffix.lower() in _IMAGE_EXTENSIONS:
            normalized_count += 1

    return normalized_count


def _read_sidecar_text(sidecar_path: Path) -> str | None:
    if not sidecar_path.is_file():
        return None
    text, _encoding = _read_text_sidecar_bytes(sidecar_path)
    return text.strip()


def _materialize_editable_prompts(effective_dir: str, editable_extension: str) -> int:
    created_count = 0
    for image_path in _iter_image_files(effective_dir):
        prompt_path = image_path.with_suffix(_EDITABLE_PROMPT_EXTENSION)
        if prompt_path.exists():
            continue

        prompt_text = _read_sidecar_text(image_path.with_suffix(editable_extension))
        if prompt_text is None:
            prompt_text = _read_sidecar_text(
                image_path.with_suffix(_RAW_CAPTION_EXTENSION)
            )
        if prompt_text is None:
            prompt_text = _read_sidecar_text(image_path.with_suffix(_RAW_TAG_EXTENSION))
        if prompt_text is None:
            continue

        prompt_path.write_text(f"{prompt_text}\n", encoding="utf-8")
        created_count += 1

    return created_count


def _get_missing_python_modules(
    python: str, modules: list[str], cwd: str | None = None
) -> list[str]:
    probe = (
        "import importlib.util, json; "
        f"mods = {modules!r}; "
        "missing = [m for m in mods if importlib.util.find_spec(m) is None]; "
        "print(json.dumps(missing))"
    )
    result = subprocess.run(
        [python, "-c", probe],
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        cwd=cwd,
        env={**os.environ, **_UTF8_ENV},
    )
    if result.returncode != 0:
        return modules

    try:
        parsed = json.loads(result.stdout.strip() or "[]")
    except json.JSONDecodeError:
        return modules
    return [str(module) for module in parsed]


def run_preprocessing(config: dict[str, Any]) -> bool:
    """
    Execute the full preprocessing pipeline based on preprocessOptions.
    Returns True on success, False on failure.
    """
    opts: dict[str, Any] = config.get("preprocessOptions", {})

    work_dir: str = config["workDir"]
    sd_dir: str = config["sdScriptsDir"]
    python = sys.executable
    dataset_subsets = _resolve_dataset_subsets(config)
    if not dataset_subsets:
        error("[preprocess] No dataset subsets configured")
        return False

    steps = []
    skip_preprocessing = opts.get("skipPreprocessing", False)
    run_normalize = opts.get("normalizeImages", True) and not skip_preprocessing
    run_resize = opts.get("runResize", False) and not skip_preprocessing
    run_wd14 = opts.get("runWd14Tagger", True) and not skip_preprocessing
    captioning = opts.get("runCaptioning", "none") if not skip_preprocessing else "none"
    caption_extension = _get_caption_extension(opts)
    model_type = str(config.get("modelType") or "")
    wd14_model_dir = _get_wd14_model_dir(work_dir)

    if skip_preprocessing:
        info("Preprocessing steps skipped by user; preparing managed dataset only")

    if (
        opts.get("runPrepareBuckets", False)
        and model_type not in _PREPARE_BUCKETS_SUPPORTED
    ):
        error(
            f"[preprocess] runPrepareBuckets is not supported for modelType={model_type or 'unknown'}"
        )
        return False

    # Step 1: Normalize images before any tagger/caption step.
    if run_normalize:
        for subset in dataset_subsets:
            normalized_dir = _get_normalized_subset_dir(work_dir, subset)
            try:
                normalized_files = _normalize_subset_images(
                    subset["imageDir"],
                    normalized_dir,
                    str(opts.get("normalizedFormat") or "copy"),
                )
            except Exception as exc:
                error(f"[preprocess] Image normalization failed for {subset['label']}: {exc}")
                return False
            info(
                f"[preprocess] Normalized images: {subset['label']} -> {normalized_dir} ({normalized_files} files)"
            )

    # Step 2: Resize images
    if run_resize:
        for subset in dataset_subsets:
            out_dir = os.path.join(work_dir, "resized", subset["workKey"])
            resize_src = _get_normalized_subset_dir(work_dir, subset) if run_normalize else subset["imageDir"]
            steps.append(
                (
                    f"resize:{subset['label']}",
                    _resize_step(python, sd_dir, resize_src, out_dir, opts),
                )
            )
    elif not run_normalize:
        for subset in dataset_subsets:
            effective_dir = _get_effective_subset_dir(work_dir, subset, opts)
            copied_files = _prepare_effective_subset_dir(
                subset["imageDir"], effective_dir
            )
            info(
                f"[preprocess] Prepared managed subset: {subset['label']} -> {effective_dir} ({copied_files} files)"
            )

    for subset in dataset_subsets:
        effective_dir = _get_effective_subset_dir(work_dir, subset, opts)

        # Step 2: WD14 tagger
        if run_wd14:
            missing_modules = _get_missing_python_modules(
                python, ["accelerate", "huggingface_hub", "onnx", "onnxruntime"], cwd=sd_dir
            )
            if missing_modules:
                error(_WD14_DEPENDENCY_ERROR.format(modules=", ".join(missing_modules)))
                return False
            info(f"[preprocess] WD14 model cache: {wd14_model_dir}")
            steps.append(
                (
                    f"wd14-tagger:{subset['label']}",
                    _wd14_step(python, sd_dir, effective_dir, wd14_model_dir, opts),
                )
            )

        # Step 3: Captioning
        if captioning == "blip":
            steps.append(
                (
                    f"blip-caption:{subset['label']}",
                    _blip_step(python, sd_dir, effective_dir, caption_extension),
                )
            )
        elif captioning == "git":
            steps.append(
                (
                    f"git-caption:{subset['label']}",
                    _git_step(python, sd_dir, effective_dir, caption_extension),
                )
            )

        # Step 4: Merge captions/tags to metadata
        if run_wd14 or captioning != "none":
            subset_meta_dir = os.path.join(work_dir, "metadata", subset["workKey"])
            os.makedirs(subset_meta_dir, exist_ok=True)
            meta_path = os.path.join(subset_meta_dir, "metadata.json")
            metadata_for_buckets = meta_path
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
                metadata_for_buckets = meta_capt
                if run_wd14:
                    steps.append(
                        (
                            f"merge-tags:{subset['label']}",
                            _merge_tags_step(
                                python,
                                sd_dir,
                                effective_dir,
                                meta_path,
                                meta_capt,
                                opts,
                            ),
                        )
                    )
                    meta_clean = os.path.join(subset_meta_dir, "meta_clean.json")
                    steps.append(
                        (
                            f"clean-metadata:{subset['label']}",
                            _clean_step(python, sd_dir, meta_path, meta_clean),
                        )
                    )
                    metadata_for_buckets = meta_clean
            else:
                steps.append(
                    (
                        f"merge-tags:{subset['label']}",
                        _merge_tags_only_step(
                            python, sd_dir, effective_dir, meta_path, opts
                        ),
                    )
                )
                metadata_for_buckets = meta_path

            # Step 6: Prepare buckets/latents
            if opts.get("runPrepareBuckets", False):
                steps.append(
                    (
                        f"prepare-buckets:{subset['label']}",
                        _buckets_step(
                            python,
                            sd_dir,
                            effective_dir,
                            metadata_for_buckets,
                            os.path.join(subset_meta_dir, "meta_final.json"),
                            config["baseModelPath"],
                            opts,
                        ),
                    )
                )

    for name, cmd in steps:
        info(f"[preprocess] Starting: {name}")
        # Run all finetune scripts from sd_dir so `import library.*` resolves correctly
        ok = _run_cmd(name, cmd, cwd=sd_dir)
        if not ok:
            error(f"[preprocess] Failed at step: {name}")
            return False
        info(f"[preprocess] Done: {name}")

    if not steps:
        info("Preprocessing skipped (all heavy steps disabled)")

    for subset in dataset_subsets:
        effective_dir = _get_effective_subset_dir(work_dir, subset, opts)
        created_count = _materialize_editable_prompts(effective_dir, caption_extension)
        info(
            f"[preprocess] Materialized editable prompts: {subset['label']} ({created_count} created)"
        )

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


def _wd14_step(
    python: str, sd_dir: str, img_dir: str, model_dir: str, opts: dict
) -> list[str]:
    return [
        python,
        os.path.join(sd_dir, "finetune", "tag_images_by_wd14_tagger.py"),
        "--onnx",
        "--model_dir",
        model_dir,
        "--batch_size",
        str(opts.get("wd14BatchSize", 8)),
        "--thresh",
        str(opts.get("wd14Threshold", 0.35)),
        "--caption_extension",
        _RAW_TAG_EXTENSION,
        "--recursive",
        img_dir,
    ]


def _blip_step(
    python: str, sd_dir: str, img_dir: str, caption_extension: str
) -> list[str]:
    return [
        python,
        os.path.join(sd_dir, "finetune", "make_captions.py"),
        "--batch_size",
        "4",
        "--caption_extension",
        caption_extension,
        "--recursive",
        img_dir,
    ]


def _git_step(
    python: str, sd_dir: str, img_dir: str, caption_extension: str
) -> list[str]:
    return [
        python,
        os.path.join(sd_dir, "finetune", "make_captions_by_git.py"),
        "--batch_size",
        "4",
        "--caption_extension",
        caption_extension,
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
        _RAW_CAPTION_EXTENSION,
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
        _RAW_TAG_EXTENSION,
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
        _RAW_TAG_EXTENSION,
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
