import { Global, Inject, Injectable, Module, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';
import { APP_CONFIG, AppConfig } from '../config/env';

/**
 * Two connections: one for commands/publishing, one dedicated to SUBSCRIBE
 * (a Redis connection in subscriber mode cannot run other commands).
 */
@Injectable()
export class RedisService implements OnModuleDestroy {
  readonly client: Redis;
  readonly subscriber: Redis;

  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    this.client = new Redis(config.redisUrl, { maxRetriesPerRequest: 3, lazyConnect: false });
    this.subscriber = new Redis(config.redisUrl, { maxRetriesPerRequest: null });
  }

  /** Distributed lock so only one API instance runs a periodic job at a time. */
  async tryLock(key: string, ttlMs: number): Promise<boolean> {
    return (await this.client.set(`lock:${key}`, process.pid.toString(), 'PX', ttlMs, 'NX')) === 'OK';
  }

  async onModuleDestroy() {
    this.client.disconnect();
    this.subscriber.disconnect();
  }
}

@Global()
@Module({
  providers: [RedisService],
  exports: [RedisService],
})
export class RedisModule {}
