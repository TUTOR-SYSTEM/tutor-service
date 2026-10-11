import { Controller, Post } from '@nestjs/common';
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { AgentsService } from './agents.service';

@Controller()
export class AgentController {
  constructor(private readonly agentsService: AgentsService) {}

  // Each call starts a paid Claude Agent SDK session, so it needs a valid JWT (was @Public()).
  @Post('run')
  run(): Promise<SDKMessage[]> {
    return this.agentsService.run('1+1=?');
  }
}
