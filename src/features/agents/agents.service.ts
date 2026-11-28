import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BadRequestException, GatewayTimeoutException, Injectable } from '@nestjs/common';
import { query, type Options, type SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import type { ChatDto, GetHistoryQueryDto } from '@packages/entities/ai-chat';
import { CLAUDE_MODELS } from './agents.config';

const MAX_HISTORY_PER_USER = 100; // bound memory: this map lives for the process lifetime
const MAX_HISTORY_USERS = 500; // LRU bound on distinct users kept in memory (TS-07)
const MAX_MESSAGE_CHARS = 4000; // mirrors chatSchema; the RPC path is not Zod-validated (TS-07)
const RUN_TIMEOUT_MS = 120_000; // a run that never finishes is aborted (TS-07)
const HISTORY_DEFAULT_LIMIT = 50; // ai.history: missing / invalid limit (TS-13)
const HISTORY_MAX_LIMIT = 100;

// The prompt is end-user text, so the agent must not be able to act on the host: no built-in
// tools (no Read/Bash/Edit), no permission bypass, no project/user settings or hooks loaded from
// the working directory, an empty throwaway cwd, and a turn cap. Applied after any caller
// options so they cannot re-enable tools.
const SANDBOX_CWD = join(tmpdir(), 'tutor-agent-sandbox');
mkdirSync(SANDBOX_CWD, { recursive: true });
const AGENT_SANDBOX_OPTIONS: Options = {
  tools: [],
  allowedTools: [],
  permissionMode: 'default',
  settingSources: [],
  cwd: SANDBOX_CWD,
  maxTurns: 3,
};

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
        ...AGENT_SANDBOX_OPTIONS,
      },
    });

    for await (const message of result) {
      messages.push(message);
    }

    return messages;
  }

  async chat({ userId, data }: { userId: string; data: ChatDto }) {
    if (data.message.length > MAX_MESSAGE_CHARS) throw new BadRequestException('MESSAGE_TOO_LONG');
    const answer = await this.runWithTimeout(data.message);
    const replyText = this.extractReply(answer) || 'Không có phản hồi từ trợ lý.';

    const reply: AiChatMessage = {
      role: 'assistant',
      content: replyText,
      createdAt: new Date().toISOString(),
    };
    this.appendHistory(userId, data.message);
    this.appendHistory(userId, reply.content, 'assistant');

    // `reply` is the answer text (CONTRACT C4); the full message record rides alongside it
    return { reply: reply.content, message: reply, history: this.historyFor(userId) };
  }

  private async runWithTimeout(prompt: string): Promise<SDKMessage[]> {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new GatewayTimeoutException('AI_RUN_TIMEOUT'));
      }, RUN_TIMEOUT_MS);
    });
    try {
      return await Promise.race([this.run(prompt, { abortController: controller }), timeout]);
    } finally {
      clearTimeout(timer);
    }
  }

  /** Final answer of a success result; falls back to the assistant text blocks. */
  private extractReply(messages: SDKMessage[]): string {
    const result = messages.findLast((m) => m.type === 'result');
    if (result?.type === 'result' && result.subtype === 'success' && result.result.trim())
      return result.result.trim();
    return messages
      .flatMap((m) => (m.type === 'assistant' ? m.message.content : []))
      .flatMap((block) => (block.type === 'text' ? [block.text] : []))
      .join('\n')
      .trim();
  }

  getHistory({ userId, query }: { userId: string; query: GetHistoryQueryDto }) {
    return this.historyFor(userId).slice(-normalizeHistoryLimit(query?.limit));
  }

  clearHistory({ userId }: { userId: string }) {
    this.history.delete(userId);
    return { success: true };
  }

  private historyFor(userId: string): AiChatMessage[] {
    const entries = this.history.get(userId);
    if (!entries) return [];
    // touch: move to the end so the map's first key is always the least recently used user
    this.history.delete(userId);
    this.history.set(userId, entries);
    return entries;
  }

  private appendHistory(userId: string, content: string, role: AiChatMessage['role'] = 'user') {
    const entries = this.history.get(userId) ?? [];
    entries.push({ role, content, createdAt: new Date().toISOString() });
    if (entries.length > MAX_HISTORY_PER_USER)
      entries.splice(0, entries.length - MAX_HISTORY_PER_USER);
    this.history.delete(userId);
    this.history.set(userId, entries);
    if (this.history.size > MAX_HISTORY_USERS) {
      const oldest = this.history.keys().next().value as string | undefined;
      if (oldest !== undefined) this.history.delete(oldest);
    }
  }
}

/** ai.history limit: missing, zero, negative or NaN falls back to the default; capped at the max (TS-13). */
function normalizeHistoryLimit(raw: unknown): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1) return HISTORY_DEFAULT_LIMIT;
  return Math.min(Math.floor(n), HISTORY_MAX_LIMIT);
}
