import 'reflect-metadata';
import { ForbiddenException, INestApplicationContext, Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { IoAdapter } from '@nestjs/platform-socket.io';
import cookieParser from 'cookie-parser';
import type { NextFunction, Request, Response } from 'express';
import helmet from 'helmet';
import type { IncomingMessage } from 'http';
import type { ServerOptions } from 'socket.io';
import { AppModule } from './app.module';
import { CSRF_HEADER } from './common/auth/guards';
import { buildAllowlist } from './common/security/ip-allowlist';
import { AppConfig, loadConfig } from './config/env';

class ConfiguredIoAdapter extends IoAdapter {
  constructor(
    app: INestApplicationContext,
    private readonly config: AppConfig,
    private readonly allowed: (ip: string | undefined) => boolean,
  ) {
    super(app);
  }

  createIOServer(port: number, options?: ServerOptions) {
    return super.createIOServer(port, {
      ...options,
      cors: { origin: this.config.corsOrigins, credentials: true },
      // Same IP allowlist as HTTP. With TRUST_PROXY the client IP comes from X-Forwarded-For (set by Nginx).
      allowRequest: (req: IncomingMessage, cb: (err: string | null | undefined, ok: boolean) => void) => {
        const fwd = this.config.trustProxy ? String(req.headers['x-forwarded-for'] ?? '').split(',').pop()!.trim() : '';
        cb(null, this.allowed(fwd || req.socket.remoteAddress));
      },
    });
  }
}

async function bootstrap() {
  const config = loadConfig();
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: false });
  const allowed = buildAllowlist(config.ipAllowlist);

  if (config.trustProxy) app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.use(helmet());
  app.use(cookieParser());
  app.use((req: Request, _res: Response, next: NextFunction) => {
    if (!allowed(req.ip)) return next(new ForbiddenException('Source address not allowed'));
    next();
  });
  app.enableCors({
    origin: config.corsOrigins.length ? config.corsOrigins : false,
    credentials: true,
    allowedHeaders: ['Content-Type', CSRF_HEADER],
  });
  app.setGlobalPrefix('api');
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: false },
    }),
  );
  app.useWebSocketAdapter(new ConfiguredIoAdapter(app, config, allowed));
  app.enableShutdownHooks();

  await app.listen(config.port, '0.0.0.0');
  Logger.log(`API listening on :${config.port}`, 'Bootstrap');
}

void bootstrap();
