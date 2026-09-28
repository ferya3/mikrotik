import { Module } from '@nestjs/common';
import { RoutersModule } from '../routers/routers.module';
import { BulkController, BulkService } from './bulk';
import { FirewallController } from './firewall.controller';
import { InterfacesController, IpAddressesController, RoutesController } from './ip.controller';
import { NetworkService } from './network.service';
import { DhcpController, PppController, QueuesController, SystemController } from './services.controller';

@Module({
  imports: [RoutersModule],
  controllers: [
    FirewallController,
    InterfacesController,
    IpAddressesController,
    RoutesController,
    DhcpController,
    PppController,
    QueuesController,
    SystemController,
    BulkController,
  ],
  providers: [NetworkService, BulkService],
  exports: [NetworkService],
})
export class NetworkModule {}
