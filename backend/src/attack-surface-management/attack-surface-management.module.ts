import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PrismaService } from '../prisma.service';
import { AssetsController } from './assets.controller';
import { AssetsService } from './assets.service';
import { DiscoveryClient } from './discovery.client';
import { DiscoveryService } from './discovery.service';

@Module({
  imports: [AuthModule],
  controllers: [AssetsController],
  providers: [AssetsService, DiscoveryService, DiscoveryClient, PrismaService],
})
export class AttackSurfaceManagementModule {}

