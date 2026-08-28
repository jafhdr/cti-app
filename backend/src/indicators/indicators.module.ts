import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PrismaService } from '../prisma.service';
import { IndicatorsController } from './indicators.controller';
import { IndicatorsService } from './indicators.service';

@Module({ imports: [AuthModule], controllers: [IndicatorsController], providers: [IndicatorsService, PrismaService] })
export class IndicatorsModule {}
