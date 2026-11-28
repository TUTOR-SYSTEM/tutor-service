// Load env vars before any other import so a future RmqProducer/ClientsModule
// (module-top-level `process.env.RABBITMQ_URL` reads) never races ConfigModule's
// dotenv loading — see gateway/USER's main.ts for the bug this prevents.
import 'dotenv/config';
import { resolveRabbitMqUrl } from './features/rabbitmq/rmq-url';
import { Logger } from '@nestjs/common';
import { NestFactory, Reflector } from '@nestjs/core';
import { MicroserviceOptions, Transport } from '@nestjs/microservices';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { ResponseInterceptor } from '@packages/interceptor/response.interceptor';
import { ErrorInterceptor } from '@packages/interceptor';
import { HttpExceptionFilter, RpcExceptionFilter } from '@packages/filters';
import { TraceContextInterceptor } from '@packages/interceptor';
import {
  RpcIdentityInterceptor,
  RpcReplayGuard,
} from '@packages/interceptor/rpc-identity.interceptor';
import { RmqProducer } from './features/rabbitmq/rmq.producer';
import { resolveCorsOrigins } from '@packages/helpers/cors.helper';
import { isSwaggerEnabled } from '@packages/helpers/swagger.helper';

async function bootstrap() {
  // tutor-service seals/verifies user identity on RPC: the secret is shared with gateway and required.
  const rpcActorSecret = process.env.RPC_ACTOR_SECRET?.trim();
  if (!rpcActorSecret) {
    throw new Error('RPC_ACTOR_SECRET must be set (shared with gateway)');
  }
  const app = await NestFactory.create(AppModule, {
    logger: ['error', 'warn', 'log', 'debug', 'verbose'],
  });

  // origin allowlist from CORS_ORIGINS (never `origin: true` with credentials in production)
  app.enableCors({ origin: resolveCorsOrigins(), credentials: true });
  app.useGlobalInterceptors(new ResponseInterceptor(app.get(Reflector)));
  app.useGlobalInterceptors(new ErrorInterceptor());
  app.useGlobalFilters(new HttpExceptionFilter());

  // `deferInitialization: true` is required: by default `connectMicroservice()` synchronously
  // calls `registerListeners()` before returning, which binds every @MessagePattern handler to
  // whatever global filters exist *at that moment* (none) — a `useGlobalFilters()` call after
  // that point is silently too late (Nest logs "Cannot apply global exception filters:
  // registration must occur before initialization" and the base `BaseRpcExceptionFilter`
  // fallback keeps handling errors instead). Deferring means listener registration happens
  // inside `startAllMicroservices()` → `listen()`, after our filter is already in place.
  const rmqMicroservice = app.connectMicroservice<MicroserviceOptions>(
    {
      transport: Transport.RMQ,
      options: {
        urls: [resolveRabbitMqUrl() ?? 'amqp://guest:guest@localhost:5672'],
        queue: process.env.TUTOR_QUEUE ?? 'tutor_queue',
        queueOptions: { durable: true },
        prefetchCount: 10,
      },
    },
    { deferInitialization: true },
  );

  // Global for this microservice only — every @MessagePattern handler gets it for free, no
  // per-controller @UseFilters(RpcExceptionFilter) needed. Kept off the HTTP `app` global
  // filters (RpcExceptionFilter expects an RPC context, not an Express Response).
  rmqMicroservice.useGlobalFilters(new RpcExceptionFilter());
  // Opens the correlationId/traceId/serviceName RequestContext for every @MessagePattern
  // handler — see [[rmq-rpc-plumbing]] memory.
  // Replay counter shared with user-service (third-service `redis.incr`). No retry: a retried INCR
  // would count the same delivery twice.
  const rmqProducer = app.get(RmqProducer);
  const replayClaim = async (key: string, windowSeconds: number) => {
    const { count } = await rmqProducer.send<
      { count: number },
      { key: string; windowSeconds: number }
    >('redis.incr', { key, windowSeconds }, 2000, 0);
    return count === 1;
  };
  rmqMicroservice.useGlobalInterceptors(
    new RpcIdentityInterceptor(rpcActorSecret, new RpcReplayGuard(replayClaim)),
    new TraceContextInterceptor(),
  );

  // Swagger is off in production unless SWAGGER_ENABLED=true (see swagger.helper.ts)
  if (isSwaggerEnabled()) {
    const config = new DocumentBuilder()
      .setTitle('Tutor Service API')
      .setDescription(
        'API documentation for tutor-service (classes, schedules, sessions, curriculum, tuition, reports)',
      )
      .setVersion('1.0')
      .addBearerAuth(
        {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          description: 'Enter JWT access token',
        },
        'access-token',
      )
      // ── Tutor features (the tags this repo's controllers use) ──
      .addTag('Classes')
      .addTag('Schedules')
      .addTag('Sessions')
      .addTag('Curriculum')
      .addTag('Chapter')
      .addTag('Lesson')
      .addTag('Exercises')
      .addTag('Tuitions')
      .addTag('Attendance')
      .addTag('Chat')
      .addTag('Dashboard')
      .addTag('Reports')
      // ── System ────────────────────────────────────────
      .addTag('Health')
      .build();
    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup('api-docs', app, document, {
      swaggerOptions: {
        persistAuthorization: true,
      },
    });
  }

  await app.startAllMicroservices();
  Logger.log(
    `[TUTOR] RabbitMQ listener bound (queue "${process.env.TUTOR_QUEUE ?? 'tutor_queue'}")`,
    'Bootstrap',
  );

  const port = process.env.PORT ?? 8888;
  await app.listen(port);
  Logger.log(`[TUTOR] listening on port ${port}`, 'Bootstrap');
}
void bootstrap();
