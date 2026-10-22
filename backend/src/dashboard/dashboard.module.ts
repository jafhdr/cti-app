import { Module } from '@nestjs/common';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';
import { DashboardDiscoveryController } from './dashboard-discovery.controller';
import { DashboardDiscoveryService } from './dashboard-discovery.service';
import { DashboardNotificationsService } from './dashboard-notifications.service';
import { AuthModule } from '../auth/auth.module';
import { SubscriptionModule } from '../subscription/subscription.module';
import { PrismaService } from '../prisma.service';

@Module({
  imports: [AuthModule, SubscriptionModule],
  controllers: [DashboardController, DashboardDiscoveryController],
  providers: [DashboardService, DashboardDiscoveryService, DashboardNotificationsService, PrismaService],
})
export class DashboardModule {}
