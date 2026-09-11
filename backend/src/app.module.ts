import { Module } from '@nestjs/common';
import { UsersModule } from './users/users.module';
import { ConfigModule } from '@nestjs/config';
import { PrismaService } from './prisma.service';
import { AuthModule } from './auth/auth.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { AuditModule } from './audit/audit.module';
import { IndicatorsModule } from './indicators/indicators.module';
import { TenantsModule } from './tenants/tenants.module';
import { ModulesModule } from './modules/modules.module';
import { IntelligenceModule } from './intelligence/intelligence.module';
import { SubscriptionModule } from './subscription/subscription.module';
import { ScheduleModule } from '@nestjs/schedule';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ScheduleModule.forRoot(),
    AuthModule,
    DashboardModule,
    AuditModule,
    IndicatorsModule,
    TenantsModule,
    ModulesModule,
    IntelligenceModule,
    SubscriptionModule,
    UsersModule,
  ],
  providers: [PrismaService],
  exports: [PrismaService],
})
export class AppModule {}
