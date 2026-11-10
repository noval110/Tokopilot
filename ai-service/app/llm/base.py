"""Provider abstraction. Every LLM vendor adapter implements LLMProvider."""

from dataclasses import dataclass, field
from typing import Any, Protocol

from app.schemas.chat import ChatContext, ChatMessage, ToolDef


class ProviderError(Exception):
    """Non-retryable provider failure (bad credentials, rejected request)."""


class ProviderTransientError(ProviderError):
    """Retryable failure (rate limit, 5xx, network blip)."""


@dataclass
class ProposedToolCall:
    id: str
    name: str
    arguments: Any  # validated by the orchestrator, then again by the Go API


@dataclass
class LLMResult:
    text: str | None = None
    tool_calls: list[ProposedToolCall] = field(default_factory=list)


class LLMProvider(Protocol):
    name: str

    async def complete(self, messages: list[ChatMessage], tools: list[ToolDef], context: ChatContext) -> LLMResult:
        """Return either text or proposed tool calls. Must not execute tools or touch data."""
        ...
