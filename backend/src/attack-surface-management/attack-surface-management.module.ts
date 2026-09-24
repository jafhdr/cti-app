import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PrismaService } from '../prisma.service';
import { AssetsController } from './assets.controller';
import { AssetsService } from './assets.service';
import { DiscoveryClient } from './discovery.client';
import { DiscoveryService } from './discovery.service';
import { PortServicesController } from './port-services.controller';
import { PortDiscoveryClient } from './port-discovery.client';
import { PortDiscoveryService } from './port-discovery.service';
import { PortServicesService } from './port-services.service';

@Module({
  imports: [AuthModule],
  controllers: [AssetsController, PortServicesController],
  providers: [
    AssetsService,
    DiscoveryService,
    DiscoveryClient,
    PortDiscoveryService,
    PortDiscoveryClient,
    PortServicesService,
    PrismaService,
  ],
})
export class AttackSurfaceManagementModule {}

