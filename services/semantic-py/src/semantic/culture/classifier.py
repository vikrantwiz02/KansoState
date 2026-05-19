"""Cultural context classifier — called at most once per meeting per 30 s, not per utterance."""
from __future__ import annotations

import time
from typing import Any


# Few-shot examples for the classifier
_FEW_SHOT_EXAMPLES = [
    {
        "window": ["Let's align on this offline", "I'll loop in the relevant stakeholders"],
        "tags": ["indirect", "high-context"],
        "bridge_note": "Speakers use indirect language; direct action items may need explicit follow-up.",
    },
    {
        "window": ["Ship it now", "Block this, it's broken", "LGTM, merge"],
        "tags": ["direct", "low-context"],
        "bridge_note": None,
    },
]

_SYSTEM_PROMPT = """You are a meeting communication analyst.
Given a window of utterances from a meeting, classify the dominant communication style.

Output JSON: {"tags": [...], "bridge_note": "..." or null}

tags must be a subset of: ["direct", "indirect", "high-context", "low-context",
"formal", "informal", "hierarchical", "flat", "consensus-seeking", "assertive"]

bridge_note is one sentence of practical guidance for participants, or null if no note is needed.
Only output valid JSON, no prose."""


class CultureClassifier:
    def __init__(self, llm_model: str, api_key: str) -> None:
        from langchain_openai import ChatOpenAI

        self._llm = ChatOpenAI(model=llm_model, api_key=api_key, temperature=0)
        self._last_results: dict[str, tuple[float, list[str], str | None]] = {}

    def classify(
        self, meeting_id: str, window: list[str], lang_hint: str | None = None
    ) -> tuple[list[str], str | None]:
        now = time.monotonic()
        if meeting_id in self._last_results:
            ts, tags, note = self._last_results[meeting_id]
            if now - ts < 30:
                return tags, note

        from langchain_core.messages import HumanMessage, SystemMessage
        import json

        messages = [SystemMessage(content=_SYSTEM_PROMPT)]
        for ex in _FEW_SHOT_EXAMPLES:
            messages.append(
                HumanMessage(content=f"Utterances: {json.dumps(ex['window'])}")
            )
            messages.append(
                HumanMessage(
                    content=f"Response: {json.dumps({'tags': ex['tags'], 'bridge_note': ex['bridge_note']})}"
                )
            )

        lang_hint_str = f" (language hint: {lang_hint})" if lang_hint else ""
        messages.append(
            HumanMessage(content=f"Utterances{lang_hint_str}: {json.dumps(window)}")
        )

        try:
            response = self._llm.invoke(messages)
            result: dict[str, Any] = json.loads(str(response.content))
            tags = result.get("tags", [])
            note = result.get("bridge_note")
        except Exception:
            # fall back to last known result or empty
            if meeting_id in self._last_results:
                _, tags, note = self._last_results[meeting_id]
            else:
                tags, note = [], None

        self._last_results[meeting_id] = (now, tags, note)
        return tags, note


class NoopCultureClassifier:
    """Fallback when no LLM API key is configured."""

    def classify(
        self, meeting_id: str, window: list[str], lang_hint: str | None = None
    ) -> tuple[list[str], str | None]:
        return [], None
