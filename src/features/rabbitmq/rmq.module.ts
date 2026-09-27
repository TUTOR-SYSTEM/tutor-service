import { Global, Module } from '@nestjs/common';
import { ClientsModule, Transport } from '@nestjs/microservices';
import {
  RABBITMQ_URL,
  RMQ_QUEUES,
  RmqTarget,
  THIRD_SERVICE,
  TUTOR_SERVICE,
  USER_SERVICE,
} from './rmq.constants';
import { RmqProducer } from './rmq.producer';

const rmqClient = (name: RmqTarget) => ({
  name,
  transport: Transport.RMQ as const,
  options: {
    urls: [RABBITMQ_URL],
    queue: RMQ_QUEUES[name],
    queueOptions: { durable: true },
    persistent: true,
  },
});

@Global()
@Module({
  imports: [
    ClientsModule.register([
      rmqClient(USER_SERVICE),
      rmqClient(TUTOR_SERVICE),
      rmqClient(THIRD_SERVICE),
    ]),
  ],
  providers: [RmqProducer],
  exports: [RmqProducer],
})
export class RmqModule {}
