import { apiFetch } from '@/lib/api'
import type { Page } from './auth'

export interface Conversation {
  id: string
  title: string
  created_at: string
  updated_at: string
}

export interface AssistantSource {
  tool: string
  label: string
  from?: string
  to?: string
  as_of: string
}

export interface AssistantMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  sources: AssistantSource[]
  created_at: string
}

export const assistantApi = {
  list: () => apiFetch<Page<Conversation>>('/assistant/conversations?per_page=50'),
  create: () => apiFetch<Conversation>('/assistant/conversations', { method: 'POST' }),
  get: (id: string) =>
    apiFetch<{ conversation: Conversation; messages: AssistantMessage[] }>(`/assistant/conversations/${encodeURIComponent(id)}`),
  send: (id: string, content: string) =>
    apiFetch<{ messages: [AssistantMessage, AssistantMessage] }>(`/assistant/conversations/${encodeURIComponent(id)}/messages`, {
      method: 'POST',
      body: { content },
    }),
}

export const assistantKeys = {
  list: ['assistant', 'list'] as const,
  conversation: (id: string) => ['assistant', 'conversation', id] as const,
}
