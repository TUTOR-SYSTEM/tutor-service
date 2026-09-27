import { Controller } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import type { ChatDto, GetHistoryQueryDto } from '@packages/entities/ai-chat';
import { AgentsService } from './agents.service';

/**
 * Message-pattern mirror of the AI-assistant endpoints (`/ai-chat`) — reached only by the
 * gateway's `TUTOR_SERVICE` `ClientProxy` over RabbitMQ.
 * Delegates to `AgentsService` (the same service the `/run` HTTP controller uses) plus its
 * in-memory per-user chat history; no business logic lives here.
 */
@Controller()
export class AgentsRpcController {
  constructor(private readonly agentsService: AgentsService) {}

  @MessagePattern('ai.chat')
  chat(@Payload() payload: { userId: string; data: ChatDto }) {
    return this.agentsService.chat(payload);
  }

  @MessagePattern('ai.history')
  getHistory(@Payload() payload: { userId: string; query: GetHistoryQueryDto }) {
    return this.agentsService.getHistory(payload);
  }

  @MessagePattern('ai.clearHistory')
  clearHistory(@Payload() payload: { userId: string }) {
    return this.agentsService.clearHistory(payload);
  }
}