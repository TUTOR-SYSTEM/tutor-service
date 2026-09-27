import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { ConversationService } from './conversation.service';
import { MessageService } from './message.service';
import type { Request } from 'express';

type JwtUser = {
  id: string;
  email: string;
  role: string;
};

type RequestWithUser = Request & { user?: JwtUser };

@ApiTags('Chat')
@ApiBearerAuth('access-token')
@Controller('chat')
export class ChatController {
  constructor(
    private readonly conversationService: ConversationService,
    private readonly messageService: MessageService,
  ) {}

  @Get('conversations')
  @ApiOperation({ summary: 'Get all conversations for current user' })
  async getConversations(@Req() req: RequestWithUser) {
    const userId = req.user?.id;
    if (!userId) {
      throw new UnauthorizedException();
    }
    return this.conversationService.getConversations(userId);
  }

  @Get('users')
  @ApiOperation({ summary: 'Get all users current user can chat with' })
  async getChatableUsers(@Req() req: RequestWithUser) {
    const userId = req.user?.id;
    if (!userId) {
      throw new UnauthorizedException();
    }
    return this.conversationService.getChatableUsers(userId);
  }

  @Get('unread')
  @ApiOperation({ summary: 'Get unread counts for all conversations' })
  async getUnreadCounts(@Req() req: RequestWithUser) {
    const userId = req.user?.id;
    if (!userId) {
      throw new UnauthorizedException();
    }
    return this.messageService.getUnreadCounts(userId);
  }

  @Get('conversations/:id')
  @ApiOperation({ summary: 'Get conversation by ID' })
  async getConversation(@Param('id') id: string, @Req() req: RequestWithUser) {
    const userId = req.user?.id;
    if (!userId) {
      throw new UnauthorizedException();
    }
    return this.conversationService.getConversationById(id, userId);
  }

  @Get('conversations/:id/messages')
  @ApiOperation({ summary: 'Get messages for a conversation' })
  async getMessages(
    @Param('id') id: string,
    @Query('limit') limit?: string,
    @Query('before') before?: string,
    @Req() req?: RequestWithUser,
  ) {
    const userId = req?.user?.id;
    if (!userId) {
      throw new UnauthorizedException();
    }
    const messageLimit = limit ? parseInt(limit, 10) : 50;
    return this.messageService.getMessages(id, userId, messageLimit, before);
  }

  @Post('conversations/direct')
  @ApiOperation({ summary: 'Create or get direct conversation with another user' })
  async createDirectConversation(
    @Body() body: { targetUserId: string },
    @Req() req: RequestWithUser,
  ) {
    const userId = req.user?.id;
    if (!userId) {
      throw new UnauthorizedException();
    }
    return this.conversationService.createDirectConversation(userId, body.targetUserId);
  }

  @Post('conversations/group')
  @ApiOperation({ summary: 'Create group conversation' })
  async createGroupConversation(
    @Body() body: { name: string; participantIds: string[] },
    @Req() req: RequestWithUser,
  ) {
    const userId = req.user?.id;
    if (!userId) {
      throw new UnauthorizedException();
    }
    return this.conversationService.createGroupConversation(userId, body.name, body.participantIds);
  }

  @Post('conversations/class/:classId')
  @ApiOperation({ summary: 'Create or get class conversation' })
  async createClassConversation(@Param('classId') classId: string, @Req() req: RequestWithUser) {
    const userId = req.user?.id;
    if (!userId) {
      throw new UnauthorizedException();
    }
    return this.conversationService.createClassConversation(userId, classId);
  }

  @Post('conversations/:id/participants')
  @ApiOperation({ summary: 'Add participant to conversation' })
  async addParticipant(
    @Param('id') id: string,
    @Body() body: { userId: string },
    @Req() req: RequestWithUser,
  ) {
    const userId = req.user?.id;
    if (!userId) {
      throw new UnauthorizedException();
    }
    return this.conversationService.addParticipant(id, userId, body.userId);
  }

  @Post('conversations/:id/read')
  @ApiOperation({ summary: 'Mark conversation as read' })
  async markAsRead(@Param('id') id: string, @Req() req: RequestWithUser) {
    const userId = req.user?.id;
    if (!userId) {
      throw new UnauthorizedException();
    }
    await this.messageService.markConversationAsRead(id, userId);
    return { message: 'Marked as read' };
  }
}
