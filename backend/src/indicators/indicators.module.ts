import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PrismaService } from '../prisma.service';
import { IndicatorsController } from './indicators.controller';
import { IndicatorsService } from './indicators.service';
import { IndicatorFeedClients } from './indicator-feed.clients';
import { IndicatorFeedsService } from './indicator-feeds.service';
import { IndicatorFeedScheduler } from './indicator-feed.scheduler';

@Module({
  imports: [AuthModule],
  controllers: [IndicatorsController],
  providers: [IndicatorsService, IndicatorFeedsService, IndicatorFeedClients, IndicatorFeedScheduler, PrismaService],
})
export class IndicatorsModule {}
