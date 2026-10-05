import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PrismaService } from '../prisma.service';
import { CasesController } from './cases.controller';
import { CasesService } from './cases.service';
import { CaseTenantGuard } from './case-tenant.guard';

@Module({
  imports: [AuthModule],
  controllers: [CasesController],
  providers: [CasesService, CaseTenantGuard, PrismaService],
})
export class CasesModule {}
