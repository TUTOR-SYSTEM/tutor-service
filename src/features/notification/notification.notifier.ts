import { Injectable, Logger } from '@nestjs/common';
import { checkUuidValid } from '@packages/helpers';
import { RmqProducer } from '../rabbitmq/rmq.producer';

export interface NotifyUsersInput {
  /** Vai trò người thực hiện — notification-service kiểm quyền tạo theo role này. */
  role?: string | null;
  senderId: string;
  /** userId người nhận (học sinh hoặc gia sư); id rỗng/không hợp lệ/trùng sẽ bị bỏ qua. */
  recipients: Array<string | null | undefined>;
  type: 'STUDENT' | 'TUTOR';
  title: string;
  content: string;
  subContent?: string;
  redirectUrl?: string;
  /** Ép studentId của payload; mặc định = id người nhận khi type STUDENT. */
  studentId?: string;
}

/**
 * Gửi thông báo tới từng người nhận qua `notification.create`. Không bao giờ gửi `classId`
 * (service sẽ fan-out tới cả lớp). Lỗi chỉ log warn, không làm fail nghiệp vụ gọi nó.
 */
@Injectable()
export class NotificationNotifier {
  private readonly logger = new Logger(NotificationNotifier.name);
  constructor(private readonly rmqProducer: RmqProducer) {}

  async notifyUsers(input: NotifyUsersInput): Promise<void> {
    try {
      const ids = [
        ...new Set(
          input.recipients.filter((id): id is string => !!id && checkUuidValid({ data: id })),
        ),
      ];
      if (ids.length === 0 || !input.senderId) return;

      const results = await Promise.allSettled(
        ids.map((id) =>
          this.rmqProducer.send<unknown, Record<string, unknown>>(
            'notification.create',
            {
              role: input.role ?? 'TUTOR',
              type: input.type,
              title: input.title,
              content: input.content,
              ...(input.subContent ? { subContent: input.subContent.slice(0, 255) } : {}),
              senderId: input.senderId,
              userId: id,
              studentId: input.studentId ?? (input.type === 'STUDENT' ? id : undefined),
              ...(input.redirectUrl ? { redirectUrl: input.redirectUrl } : {}),
            },
            5000,
            0,
          ),
        ),
      );
      const failed = results.filter((r) => r.status === 'rejected').length;
      if (failed > 0)
        this.logger.warn(`Gửi thông báo "${input.title}" thất bại: ${failed}/${results.length}`);
    } catch (error) {
      this.logger.warn(`Gửi thông báo "${input.title}" lỗi: ${(error as Error).message}`);
    }
  }
}
