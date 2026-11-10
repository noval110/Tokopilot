"""One model step: call the provider safely and validate what it proposes.

The AI service never executes tools. It returns proposed calls to the Go API,
which validates and executes them against the authenticated store.
"""

import asyncio
import logging

from app.core.errors import ServiceError
from app.llm.base import LLMProvider, LLMResult, ProviderError, ProviderTransientError
from app.schemas.chat import ChatRequest, ChatResponse, ToolCall

logger = logging.getLogger("tokopilot.ai")

MAX_TOOL_CALLS = 4
MAX_ANSWER_CHARS = 8000


def _malformed(reason: str) -> ServiceError:
    logger.warning("provider output rejected: %s", reason)
    return ServiceError(502, "AI_MALFORMED", "Jawaban AI tidak dapat diproses.")


def validate_result(result: object, allowed: set[str]) -> ChatResponse:
    if not isinstance(result, LLMResult):
        raise _malformed("not an LLMResult")
    if result.tool_calls:
        if result.text:
            raise _malformed("both text and tool calls")
        if len(result.tool_calls) > MAX_TOOL_CALLS:
            raise _malformed("too many tool calls")
        calls, seen = [], set()
        for c in result.tool_calls:
            if c.name not in allowed:
                raise _malformed(f"tool not in allowlist: {c.name!r}")
            if not isinstance(c.arguments, dict):
                raise _malformed("arguments must be a JSON object")
            if not c.id or c.id in seen:
                raise _malformed("missing or duplicate tool call id")
            seen.add(c.id)
            calls.append(ToolCall(id=c.id, name=c.name, arguments=c.arguments))
        return ChatResponse(type="tool_calls", tool_calls=calls)
    text = (result.text or "").strip()
    if not text or len(text) > MAX_ANSWER_CHARS:
        raise _malformed("empty or oversized answer")
    return ChatResponse(type="answer", content=text)


async def run_step(provider: LLMProvider, req: ChatRequest, budget_seconds: float) -> ChatResponse:
    allowed = {t.name for t in req.tools}
    for attempt in range(2):  # at most one retry, only for transient failures
        try:
            async with asyncio.timeout(budget_seconds):
                result = await provider.complete(req.messages, req.tools, req.context)
            return validate_result(result, allowed)
        except TimeoutError as exc:
            raise ServiceError(504, "AI_TIMEOUT", "Provider AI terlalu lama merespons.") from exc
        except ProviderTransientError as exc:
            if attempt == 0:
                logger.info("transient provider error, retrying once")
                continue
            raise ServiceError(503, "AI_PROVIDER_ERROR", "Provider AI sedang bermasalah.") from exc
        except ProviderError as exc:
            # Never forward the vendor's message: it may contain keys or internals.
            raise ServiceError(503, "AI_PROVIDER_ERROR", "Provider AI sedang bermasalah.") from exc
    raise ServiceError(503, "AI_PROVIDER_ERROR", "Provider AI sedang bermasalah.")
