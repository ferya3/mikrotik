import { Global, Module } from '@nestjs/common';
import { MikrotikService } from './mikrotik.service';

@Global()
@Module({
  providers: [MikrotikService],
  exports: [MikrotikService],
})
export class MikrotikModule {}
