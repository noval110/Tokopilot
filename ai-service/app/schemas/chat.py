"""Wire contract with the Go API (/internal/v1/chat). Mirrors backend/internal/assistant/client.go."""

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field


class Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class ToolCall(Strict):
    id: str = Field(min_length=1, max_length=100)
    name: str = Field(min_length=1, max_length=64)
    arguments: dict[str, Any] = Field(default_factory=dict)


class ChatMessage(Strict):
    role: Literal["user", "assistant", "tool"]
    content: str | None = Field(default=None, max_length=20000)
    tool_calls: list[ToolCall] | None = None
    tool_call_id: str | None = None
    name: str | None = None


class ToolDef(Strict):
    name: str
    description: str
    parameters: dict[str, Any]


class ChatContext(Strict):
    today: str = Field(pattern=r"^\d{4}-\d{2}-\d{2}$")
    now: str
    timezone: str
    currency: Literal["IDR"] = "IDR"
    locale: str = "id-ID"


class ChatRequest(Strict):
    messages: list[ChatMessage] = Field(min_length=1, max_length=60)
    tools: list[ToolDef] = Field(max_length=10)
    context: ChatContext


class ChatResponse(Strict):
    type: Literal["answer", "tool_calls"]
    content: str | None = None
    tool_calls: list[ToolCall] | None = None
