"""
event_emitter.py
Helpers to emit JSON-line events to stdout (consumed by Node.js server).
"""

from __future__ import annotations
import json
import sys
import re
import time
from typing import Any

# tqdm-style progress line patterns
_TQDM_PATTERN = re.compile(r"steps:\s*(\d+)%\|.*?(\d+)/(\d+)\s*\[.*?loss=([\d.]+)")
_EPOCH_PATTERN = re.compile(r"epoch\s+(\d+)/(\d+)", re.IGNORECASE)
_LOSS_PATTERN = re.compile(r"avr_loss:\s*([\d.eE+\-]+)", re.IGNORECASE)


def emit(
    type_: str, level: str, message: str, data: dict[str, Any] | None = None
) -> None:
    payload: dict[str, Any] = {
        "type": type_,
        "level": level,
        "message": message,
        "ts": int(time.time() * 1000),
    }
    if data:
        payload["data"] = data
    print(json.dumps(payload, ensure_ascii=False), flush=True)


def info(msg: str, data: dict[str, Any] | None = None) -> None:
    emit("system", "info", msg, data)


def warn(msg: str, data: dict[str, Any] | None = None) -> None:
    emit("system", "warn", msg, data)


def error(msg: str, data: dict[str, Any] | None = None) -> None:
    emit("system", "error", msg, data)


def exit_event(code: int, msg: str = "") -> None:
    emit(
        "exit",
        "info" if code == 0 else "error",
        msg or f"Exit code {code}",
        {"exitCode": code},
    )


def parse_and_emit_training_line(line: str) -> None:
    """Parse a stdout/stderr line from the training script and emit structured event."""
    line = line.rstrip()
    if not line:
        return

    # tqdm progress bar
    m = _TQDM_PATTERN.search(line)
    if m:
        step, total = int(m.group(2)), int(m.group(3))
        loss = float(m.group(4))
        emit(
            "stdout",
            "progress",
            line,
            {
                "step": step,
                "totalSteps": total,
                "loss": loss,
                "progress": step / total if total else 0,
            },
        )
        return

    # epoch header
    m = _EPOCH_PATTERN.search(line)
    if m:
        emit("stdout", "info", line, {"epoch": int(m.group(1))})
        return

    # average loss
    m = _LOSS_PATTERN.search(line)
    if m:
        emit("stdout", "info", line, {"loss": float(m.group(1))})
        return

    # error heuristic
    low = line.lower()
    if "error" in low or "traceback" in low or "exception" in low:
        emit("stderr", "error", line)
    elif "warning" in low or "warn" in low:
        emit("stderr", "warn", line)
    else:
        emit("stdout", "info", line)
