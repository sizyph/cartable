"""Claude Agent SDK chat — loads the pronote skill and streams answers."""

from __future__ import annotations

import json
import logging
import os
from collections.abc import AsyncIterator
from pathlib import Path
from typing import Any

import claude_agent_sdk as sdk

from . import db

log = logging.getLogger("cartable_app.agent")

CARTABLE_DIR = Path(os.environ.get(
    "CARTABLE_DIR", Path.home() / "Documents/Claude/cartable"
)).expanduser()

_BASE_PROMPT = """You are Cartable, a coach and assistant embedded in a Mac app
for the parent of a student whose school uses Pronote. You have read-only
access to the student's Pronote data via the `pronote` skill — use it to
answer questions concretely with numbers, dates, and subject names. Be terse
and specific; quote grades and dates. If you draft a message to a teacher,
mark it clearly as a draft and explain why you think it's warranted.

Output plain text or simple markdown. Don't use headings, code blocks, or
ASCII art unless asked. Don't apologise or add filler."""


def _personal_context() -> str:
    """Pull name / class / school from the synced DB, if available, so the
    chat speaks about the actual student instead of generic placeholders.

    Falls back gracefully when the DB is empty or missing."""
    try:
        info = db.student_info()
    except Exception:  # noqa: BLE001
        return ""
    name = info.get("name") or ""
    klass = info.get("class_name") or ""
    school = info.get("establishment") or ""
    bits = []
    if name:
        bits.append(f"The student's name is {name}.")
    if klass:
        bits.append(f"Class: {klass}.")
    if school:
        bits.append(f"School: {school}.")
    return " ".join(bits)


def build_system_prompt() -> str:
    context = _personal_context()
    return f"{_BASE_PROMPT}\n\n{context}".rstrip()


def _serialize(msg: Any) -> dict | None:
    """Turn an SDK message into a small JSON dict the frontend can render."""
    # AssistantMessage / UserMessage have a .content list of content blocks
    if isinstance(msg, sdk.AssistantMessage):
        out_text: list[str] = []
        tool_uses: list[dict] = []
        for block in msg.content:
            kind = type(block).__name__
            if kind == "TextBlock":
                out_text.append(getattr(block, "text", "") or "")
            elif kind == "ToolUseBlock":
                tool_uses.append({
                    "name": getattr(block, "name", "?"),
                    "input": _safe_repr(getattr(block, "input", {})),
                })
            elif kind == "ThinkingBlock":
                # don't show thinking text — but flag that the model was thinking
                tool_uses.append({"name": "thinking", "input": ""})
        return {
            "role": "assistant",
            "text": "\n".join(t for t in out_text if t),
            "tools": tool_uses,
        }
    if isinstance(msg, sdk.UserMessage):
        # User messages from the SDK loop are tool results — surface a compact form
        out_text: list[str] = []
        for block in msg.content if isinstance(msg.content, list) else []:
            kind = type(block).__name__
            if kind == "ToolResultBlock":
                content = getattr(block, "content", None)
                txt = _stringify_tool_result(content)
                if txt:
                    out_text.append(_truncate(txt, 600))
        if not out_text:
            return None
        return {"role": "tool_result", "text": "\n".join(out_text)}
    if isinstance(msg, sdk.ResultMessage):
        # End-of-turn — pass the session id so we can resume.
        return {
            "role": "result",
            "session_id": getattr(msg, "session_id", None),
            "usage": _safe_repr(getattr(msg, "usage", None)),
        }
    if isinstance(msg, sdk.SystemMessage):
        # Usually init events; skip from the UI feed.
        return None
    return None


def _stringify_tool_result(content: Any) -> str:
    if content is None:
        return ""
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts = []
        for item in content:
            if isinstance(item, dict) and "text" in item:
                parts.append(str(item["text"]))
            else:
                parts.append(str(item))
        return "\n".join(parts)
    return str(content)


def _truncate(s: str, n: int) -> str:
    return s if len(s) <= n else s[:n] + f"… ({len(s)} chars)"


def _safe_repr(value: Any) -> str:
    try:
        return json.dumps(value, default=str)[:500]
    except (TypeError, ValueError):
        return repr(value)[:500]


def make_options(session_id: str | None) -> sdk.ClaudeAgentOptions:
    return sdk.ClaudeAgentOptions(
        cwd=str(CARTABLE_DIR),
        # The pronote skill tells the model exactly which Bash/Read commands
        # are useful, so we authorise those tools broadly.
        allowed_tools=["Bash", "Read", "Glob", "Grep"],
        skills=["pronote"],
        setting_sources=["user"],
        permission_mode="bypassPermissions",
        max_turns=8,
        system_prompt=build_system_prompt(),
        resume=session_id,
        continue_conversation=False,
    )


async def chat_stream(message: str, session_id: str | None) -> AsyncIterator[str]:
    """Yield SSE-formatted events for a single user message."""
    options = make_options(session_id)
    try:
        async for msg in sdk.query(prompt=message, options=options):
            payload = _serialize(msg)
            if payload is None:
                continue
            yield f"data: {json.dumps(payload)}\n\n"
        yield "event: done\ndata: {}\n\n"
    except Exception as exc:  # noqa: BLE001
        log.exception("Chat failed")
        yield f"event: error\ndata: {json.dumps({'error': f'{type(exc).__name__}: {exc}'})}\n\n"
