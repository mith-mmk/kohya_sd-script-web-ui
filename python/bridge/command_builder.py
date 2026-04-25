"""
command_builder.py
Converts a job config dict → accelerate launch argv list.
"""

from __future__ import annotations
import os
import sys
from pathlib import Path
from typing import Any

# Script mapping per model type
SCRIPT_MAP = {
    "sd1x": "train_network.py",
    "sdxl": "sdxl_train_network.py",
    "flux": "flux_train_network.py",
    "anima": "anima_train_network.py",
}


def build_train_command(config: dict[str, Any], sd_scripts_dir: str) -> list[str]:
    """
    Build the full accelerate launch command for LoRA training.

    Returns a list of strings suitable for subprocess.Popen / subprocess.run.
    Raises ValueError if required fields are missing.
    """
    model_type: str = config["modelType"]
    script_name = SCRIPT_MAP.get(model_type)
    if script_name is None:
        raise ValueError(f"Unsupported modelType: {model_type!r}")

    script_path = os.path.join(sd_scripts_dir, script_name)
    if not os.path.exists(script_path):
        raise FileNotFoundError(f"Training script not found: {script_path}")

    params: dict[str, Any] = {**config.get("params", {})}

    # Apply runtime override (e.g. conservative retry params)
    if config.get("paramsOverride"):
        params.update(config["paramsOverride"])

    cmd: list[str] = [
        sys.executable,
        "-m",
        "accelerate.commands.launch",
        "--num_cpu_threads_per_process",
        "1",
        script_path,
    ]

    # ── Required ──────────────────────────────────────────────────────────────
    _req(cmd, "--pretrained_model_name_or_path", config["baseModelPath"])
    _req(cmd, "--output_dir", config["outputDir"])
    _req(cmd, "--output_name", config["outputName"])

    # Dataset: prefer TOML if exists, else fallback to train_data_dir
    dataset_toml = os.path.join(config["workDir"], "dataset.toml")
    if os.path.exists(dataset_toml):
        _req(cmd, "--dataset_config", dataset_toml)
    else:
        _req(cmd, "--train_data_dir", config["datasetDir"])

    # ── LoRA network ─────────────────────────────────────────────────────────
    cmd += ["--network_module", "networks.lora"]
    _opt(cmd, "--network_dim", params.get("networkDim"))
    _opt(cmd, "--network_alpha", params.get("networkAlpha"))

    # ── Optimizer / LR ───────────────────────────────────────────────────────
    _opt(cmd, "--optimizer_type", params.get("optimizerType"))
    _opt(cmd, "--learning_rate", params.get("learningRate"))
    _opt(cmd, "--unet_lr", params.get("unetLr"))
    _opt(cmd, "--lr_scheduler", params.get("lrScheduler"))
    _opt(cmd, "--lr_warmup_steps", params.get("lrWarmupSteps"))

    # SDXL has two text encoders
    if model_type == "sdxl":
        _opt(cmd, "--text_encoder_lr", params.get("textEncoderLr"))

    # ── Steps / epochs ────────────────────────────────────────────────────────
    _opt(cmd, "--max_train_epochs", params.get("maxTrainEpochs"))
    _opt(cmd, "--max_train_steps", params.get("maxTrainSteps"))
    _opt(cmd, "--train_batch_size", params.get("batchSize"))

    # ── Precision / memory ───────────────────────────────────────────────────
    _opt(cmd, "--mixed_precision", params.get("mixedPrecision"))
    _flag(cmd, "--gradient_checkpointing", params.get("gradientCheckpointing", True))
    _flag(cmd, "--cache_latents", params.get("cacheLatents", True))
    _flag(cmd, "--cache_latents_to_disk", params.get("cacheLatentsToDisk", False))

    # xformers vs sdpa (prefer sdpa on PyTorch >= 2)
    import torch  # type: ignore

    if torch.cuda.is_available():
        try:
            import xformers  # type: ignore  # noqa: F401

            cmd.append("--xformers")
        except ImportError:
            cmd.append("--sdpa")
    else:
        cmd.append("--sdpa")

    # ── Save strategy ─────────────────────────────────────────────────────────
    _opt(cmd, "--save_model_as", params.get("saveModelAs", "safetensors"))
    _opt(cmd, "--save_every_n_epochs", params.get("saveEveryNEpochs"))
    _opt(cmd, "--save_every_n_steps", params.get("saveEveryNSteps"))
    _opt(cmd, "--save_last_n_epochs", params.get("saveLastNEpochs"))
    _flag(cmd, "--save_state", params.get("saveState", True))
    _flag(cmd, "--save_state_on_train_end", True)

    # ── Logging ───────────────────────────────────────────────────────────────
    log_dir = os.path.join(config["workDir"], "logs")
    cmd += ["--logging_dir", log_dir]
    cmd += ["--log_prefix", config["outputName"]]

    # ── Resume ───────────────────────────────────────────────────────────────
    if config.get("resume"):
        _req(cmd, "--resume", config["resume"])

    # ── FLUX-specific ─────────────────────────────────────────────────────────
    if model_type == "flux":
        _opt(cmd, "--clip_l", params.get("clipL"))
        _opt(cmd, "--t5xxl", params.get("t5xxl"))
        _opt(cmd, "--ae", params.get("ae"))
        _opt(cmd, "--t5xxl_max_token_length", params.get("t5xxlMaxTokenLength", 512))
        _opt(cmd, "--timestep_sampling", params.get("timestepSampling", "flux_shift"))
        cmd.append("--apply_t5_attn_mask")

    return cmd


# ─── Helpers ──────────────────────────────────────────────────────────────────


def _req(cmd: list[str], flag: str, value: Any) -> None:
    if value is None:
        raise ValueError(f"Required argument {flag} is missing")
    cmd += [flag, str(value)]


def _opt(cmd: list[str], flag: str, value: Any) -> None:
    if value is not None:
        cmd += [flag, str(value)]


def _flag(cmd: list[str], flag: str, value: Any) -> None:
    if value:
        cmd.append(flag)
