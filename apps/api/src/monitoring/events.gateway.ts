import { Logger, OnModuleInit } from '@nestjs/common';
import { OnGatewayConnection, WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';
import { SESSION_COOKIE, SessionService } from '../auth/session.service';
import { PERMISSIONS } from '../common/rbac/permissions';
import { RedisService } from '../redis/redis.module';
import { EVENTS_CHANNEL } from './alerts.service';

const ROOM_LIVE = 'live';
const ROOM_ALERTS = 'alerts';

function readCookie(header: string | undefined, name: string): string | undefined {
  for (const part of (header ?? '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return undefined;
}

/**
 * Real-time push: MikroTik → poller → Redis pub/sub → this gateway (on every API replica) → browser.
 * Sockets authenticate with the same session cookie as HTTP and join rooms by permission.
 */
@WebSocketGateway({ path: '/api/socket.io' })
export class EventsGateway implements OnGatewayConnection, OnModuleInit {
  private readonly logger = new Logger(EventsGateway.name);
  @WebSocketServer() server: Server;

  constructor(
    private readonly sessions: SessionService,
    private readonly redis: RedisService,
  ) {}

  async onModuleInit() {
    await this.redis.subscriber.subscribe(EVENTS_CHANNEL);
    this.redis.subscriber.on('message', (channel, raw) => {
      if (channel !== EVENTS_CHANNEL || !this.server) return;
      try {
        const msg = JSON.parse(raw) as { event: string; data?: unknown };
        const room = msg.event.startsWith('alert.') ? ROOM_ALERTS : ROOM_LIVE;
        this.server.to(room).emit(msg.event, msg.data ?? msg);
      } catch (e) {
        this.logger.warn(`Bad event payload: ${(e as Error).message}`);
      }
    });
  }

  async handleConnection(socket: Socket) {
    const user = await this.sessions.resolve(readCookie(socket.handshake.headers.cookie, SESSION_COOKIE));
    if (!user) {
      socket.emit('error', { message: 'unauthorized' });
      socket.disconnect(true);
      return;
    }
    socket.data.userId = user.id;
    if (user.permissions.has(PERMISSIONS.MONITORING_READ) || user.permissions.has(PERMISSIONS.ROUTER_READ)) {
      await socket.join(ROOM_LIVE);
    }
    if (user.permissions.has(PERMISSIONS.ALERT_READ)) await socket.join(ROOM_ALERTS);
  }
}
