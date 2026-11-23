import { Module } from '@nestjs/common';
import { NotificationNotifier } from './notification.notifier';

// RmqProducer đến từ RabbitMQ module global
@Module({
  providers: [NotificationNotifier],
  exports: [NotificationNotifier],
})
export class NotificationModule {}
