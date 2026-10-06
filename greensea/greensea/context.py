"""Context window accounting, rotation decisions and checkpoints.

The model's context is bounded (n_ctx per llama-server slot); the mission is not.
GreenSea keeps the mission state durable in its database and, when a session
fills up, starts a new session whose first message carries a checkpoint built
from that state. This is Greenfield's session rotation ("resumeFromOwners=true,
replayCompletedWork=false") with GreenSea itself as the owner of mission state.

Token accounting:
  * after each turn, llama-server reports usage.prompt_tokens (the full prompt,
    cached tokens included) and usage.completion_tokens; their sum is the
    measured size of the session after that turn;
  * the next user message is estimated with a chars-per-token ratio that is
    calibrated from those measurements, plus a safety margin;
  * a session opening (system prompt + checkpoint) is counted exactly with
    /tokenize when available.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

MESSAGE_OVERHEAD_TOKENS = 12
SAFETY_MARGIN = 1.10


class TokenEstimator:
    def __init__(self, chars_per_token: float = 3.2):
        self.ratio = chars_per_token
        self.samples = 0

    def estimate(self, text: str) -> int:
        return math.ceil(len(text) / self.ratio * SAFETY_MARGIN) + MESSAGE_OVERHEAD_TOKENS

    def calibrate(self, chars: int, tokens: int) -> None:
        if tokens < 64 or chars <= 0:
            return
        observed = max(1.2, min(8.0, chars / tokens))
        # Exponential moving average; trust early samples more.
        weight = 0.5 if self.samples < 4 else 0.2
        self.ratio = (1 - weight) * self.ratio + weight * observed
        self.samples += 1


class ContextVerdict:
    OK = "OK"
    ROTATE = "ROTATE"
    TOO_SMALL = "TOO_SMALL"


@dataclass
class ContextCheck:
    verdict: str
    projected_prompt: int
    limit_soft: int
    limit_hard: int

    def as_dict(self) -> dict:
        return {"verdict": self.verdict, "projected_prompt": self.projected_prompt,
                "limit_soft": self.limit_soft, "limit_hard": self.limit_hard}


def check_context(*, projected_prompt: int, max_tokens: int, n_ctx: int, rotate_at: float,
                  session_opening: bool) -> ContextCheck:
    """Can this prompt be sent in the current session?

    hard: prompt + reserved response must fit n_ctx;
    soft: prompt should stay below rotate_at * n_ctx, so a session rotates
          before it is full rather than failing mid-turn.
    A session opening cannot be rotated away: it is OK if it fits hard, TOO_SMALL otherwise.
    """
    hard = n_ctx - max_tokens
    soft = int(n_ctx * rotate_at)
    if session_opening:
        verdict = ContextVerdict.OK if projected_prompt <= hard else ContextVerdict.TOO_SMALL
    elif projected_prompt > hard or projected_prompt > soft:
        verdict = ContextVerdict.ROTATE
    else:
        verdict = ContextVerdict.OK
    return ContextCheck(verdict, projected_prompt, soft, hard)


def checkpoint_budget_tokens(*, n_ctx: int, share: float, system_tokens: int, max_tokens: int,
                             rotate_at: float) -> int:
    """Tokens available for the checkpoint in a session-opening message.

    The opening must leave room for several turns before the next rotation:
    system + checkpoint stays at or below share * n_ctx above the system prompt,
    and never beyond what rotate_at leaves after the reserved response.
    """
    by_share = int(n_ctx * share)
    by_room = int(n_ctx * rotate_at) - system_tokens - max_tokens - 400
    return max(0, min(by_share, by_room))


def memory_budget_chars(*, n_ctx: int, share: float, chars_per_token: float) -> int:
    """Total memory size that fits half of the checkpoint budget."""
    return max(1000, int(n_ctx * share * 0.5 * chars_per_token))


def _clip(text: str, limit: int) -> str:
    text = (text or "").strip()
    if len(text) <= limit:
        return text
    return text[: max(0, limit - 1)].rstrip() + "…"


def _tail(text: str, limit: int) -> str:
    text = (text or "").strip()
    if len(text) <= limit:
        return text
    return "…" + text[-limit:].lstrip()


@dataclass
class CheckpointInput:
    memory: dict[str, str]
    artifacts: dict[str, dict]          # name -> {"size", "sha256", "updated_turn"}
    progress: list[tuple[int, str, str]]  # (turn number, status, summary), oldest first
    total_turns: int
    blockers: list[str]
    last_output: str
    objective: str


@dataclass
class Checkpoint:
    text: str
    estimated_tokens: int
    progress_items: int
    memory_value_chars: int
    output_tail_chars: int
    trimmed: bool


def _render(cp: CheckpointInput, *, progress_items: int, value_chars: int, tail_chars: int,
            summary_chars: int) -> str:
    lines = ["CHECKPOINT (kept by GreenSea; authoritative over anything you assume)"]
    shown = cp.progress[-progress_items:] if progress_items else []
    lines.append(f"Progress log: {cp.total_turns} completed turns"
                 + (f", latest {len(shown)} shown (oldest first):" if shown else "."))
    for number, status, summary in shown:
        lines.append(f"  #{number} [{status}] {_clip(summary, summary_chars)}")
    if cp.memory:
        lines.append("Memory notes:")
        for key, value in cp.memory.items():
            v = _clip(value, value_chars)
            marker = " [shortened here; full note kept]" if len(value.strip()) > value_chars else ""
            lines.append(f"  {key}: {v}{marker}")
    else:
        lines.append("Memory notes: none yet.")
    if cp.artifacts:
        lines.append("Artifacts (use READ_ARTIFACT to see content):")
        for name, meta in cp.artifacts.items():
            lines.append(f"  {name}: {meta.get('size', 0)} bytes, sha256 {str(meta.get('sha256', ''))[:12]}, "
                         f"last changed turn {meta.get('updated_turn', '?')}")
    else:
        lines.append("Artifacts: none yet.")
    if cp.blockers:
        lines.append("Open blockers: " + "; ".join(_clip(b, 300) for b in cp.blockers[:10]))
    if tail_chars and cp.last_output.strip():
        lines.append("End of your last output:")
        lines.append("<<<OUTPUT")
        lines.append(_tail(cp.last_output, tail_chars))
        lines.append("OUTPUT>>>")
    return "\n".join(lines)


def build_checkpoint(cp: CheckpointInput, *, budget_tokens: int, estimator: TokenEstimator,
                     max_progress_items: int) -> Checkpoint:
    """Render the checkpoint, trimming step by step until it fits the budget.

    Trim order (least valuable first): older progress entries, output tail,
    progress summary length, memory value length, remaining progress entries.
    Memory keys, artifact index and blockers are never dropped.
    """
    progress_items = min(max_progress_items, len(cp.progress))
    tail_chars = 3000
    summary_chars = 300
    value_chars = 2000
    trimmed = False

    def attempt() -> tuple[str, int]:
        text = _render(cp, progress_items=progress_items, value_chars=value_chars,
                       tail_chars=tail_chars, summary_chars=summary_chars)
        return text, estimator.estimate(text)

    text, tokens = attempt()
    steps = 0
    while tokens > budget_tokens and steps < 200:
        steps += 1
        trimmed = True
        if progress_items > 5:
            progress_items = max(5, progress_items - max(1, progress_items // 4))
        elif tail_chars > 0:
            tail_chars = tail_chars // 2 if tail_chars > 400 else 0
        elif summary_chars > 120:
            summary_chars = max(120, summary_chars - 60)
        elif value_chars > 200:
            value_chars = max(200, int(value_chars * 0.7))
        elif progress_items > 0:
            progress_items -= 1
        else:
            break
        text, tokens = attempt()
    return Checkpoint(text=text, estimated_tokens=tokens, progress_items=progress_items,
                      memory_value_chars=value_chars, output_tail_chars=tail_chars, trimmed=trimmed)
