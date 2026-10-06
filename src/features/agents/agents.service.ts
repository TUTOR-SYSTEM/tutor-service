import { Injectable } from '@nestjs/common';
import { query, type Options, type SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import type { ChatDto, GetHistoryQueryDto } from '@packages/entities/ai-chat';
import { CLAUDE_MODELS } from './agents.config';

const MAX_HISTORY_PER_USER = 100; // bound memory: this map lives for the process lifetime

export interface AiChatMessage {
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
}

@Injectable()
export class AgentsService {
  // In-memory per-user history — dev stand-in until a DB-backed store is introduced.
  private readonly history = new Map<string, AiChatMessage[]>();

  constructor() {}

  async run(prompt: string, options?: Options): Promise<SDKMessage[]> {
    const messages: SDKMessage[] = [];

    const result = query({
      prompt,
      options: {
        model: CLAUDE_MODELS.sonnet,
        ...options,
      },
    });

    for await (const message of result) {
      messages.push(message);
    }

    return messages;
  }

  async chat({ userId, data }: { userId: string; data: ChatDto }) {
    const answer = await this.run(data.message);
    const replyText =
      answer
        .map((message) =>
          'text' in message && typeof message.text === 'string' ? message.text : '',
        )
        .filter(Boolean)
        .join('\n') || 'Không có phản hồi từ trợ lý.';

    const reply: AiChatMessage = {
      role: 'assistant',
      content: replyText,
      createdAt: new Date().toISOString(),
    };
    this.appendHistory(userId, data.message);
    this.appendHistory(userId, reply.content, 'assistant');

    return { reply, history: this.historyFor(userId) };
  }

  getHistory({ userId, query }: { userId: string; query: GetHistoryQueryDto }) {
    return this.historyFor(userId).slice(-query.limit);
  }

  clearHistory({ userId }: { userId: string }) {
    this.history.delete(userId);
    return { success: true };
  }

  private historyFor(userId: string): AiChatMessage[] {
    return this.history.get(userId) ?? [];
  }

  private appendHistory(userId: string, content: string, role: AiChatMessage['role'] = 'user') {
    const entries = this.history.get(userId) ?? [];
    entries.push({ role, content, createdAt: new Date().toISOString() });
    if (entries.length > MAX_HISTORY_PER_USER)
      entries.splice(0, entries.length - MAX_HISTORY_PER_USER);
    this.history.set(userId, entries);
  }
}
