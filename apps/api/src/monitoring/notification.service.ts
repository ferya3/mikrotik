import { Inject, Injectable, Logger } from '@nestjs/common';
import { AlertSeverity } from '@prisma/client';
import { APP_CONFIG, AppConfig } from '../config/env';

export interface Notification {
  severity: AlertSeverity;
  title: string;
  lines: string[];
}

const ICON: Record<AlertSeverity, string> = { INFO: '🔵', WARNING: '🟠', CRITICAL: '🔴' };

/** Outbound notifications. Telegram is built in; email/SMS channels plug in here. */
@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  async send(n: Notification): Promise<void> {
    const text = `${ICON[n.severity]} ${n.title}\n\n${n.lines.join('\n')}`;
    this.logger.log(text.replace(/\n+/g, ' | '));
    await this.telegram(text);
  }

  private async telegram(text: string): Promise<void> {
    const { telegramBotToken: token, telegramChatId: chatId } = this.config;
    if (!token || !chatId) return;
    try {
      const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) this.logger.warn(`Telegram responded ${res.status}`);
    } catch (e) {
      this.logger.warn(`Telegram notification failed: ${(e as Error).message}`);
    }
  }
}
