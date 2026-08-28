import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PrismaService } from '../prisma.service';
import { TenantsController } from './tenants.controller';
import { TenantsService } from './tenants.service';

@Module({ imports: [AuthModule], controllers: [TenantsController], providers: [TenantsService, PrismaService] })
export class TenantsModule {}
