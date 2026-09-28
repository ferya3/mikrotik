import { Module } from '@nestjs/common';
import { AlertsService } from './alerts.service';
import { EventsGateway } from './events.gateway';
import { MonitoringController } from './monitoring.controller';
import { NotificationService } from './notification.service';
import { PollerService } from './poller.service';

@Module({
  controllers: [MonitoringController],
  providers: [PollerService, AlertsService, NotificationService, EventsGateway],
  exports: [AlertsService, NotificationService],
})
export class MonitoringModule {}
