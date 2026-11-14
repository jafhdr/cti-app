import { BadRequestException, Body, Controller, Get, Headers, Param, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { AuthGuard } from '../auth/auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { ModuleAccessGuard } from '../auth/module-access.guard';
import { RequiresModule, RequiresModuleFeature } from '../auth/module-access.decorator';
import type { AuthUser } from '../users/users.types';
import { CreateCaseV2Input } from './case-v2.types';
import { CasesV2Service } from './cases-v2.service';

@Controller('cases')
@UseGuards(AuthGuard, RolesGuard, ModuleAccessGuard)
@RequiresModule('case-management')
@RequiresModuleFeature('case-workflow', 'case-v2-origin')
export class CasesV2Controller {
  constructor(private readonly cases: CasesV2Service) {}

  @Post('v2')
  @Roles('ADMIN', 'SUPER_ADMIN')
  async create(@Req() req: { user: AuthUser }, @Headers('idempotency-key') key: string | undefined, @Body() body: CreateCaseV2Input, @Res({ passthrough: true }) response: Response) {
    if (!key || key.length > 100 || !/^[A-Za-z0-9._:-]+$/.test(key)) throw new BadRequestException('Idempotency-Key tidak valid');
    const result = await this.cases.create(req.user, key, body);
    response.status(result.replayed || 'reused' in result ? 200 : 201);
    return result;
  }

  @Get(':id/origin')
  @Roles('USER', 'ADMIN', 'SUPER_ADMIN')
  origin(@Req() req: { user: AuthUser }, @Param('id') id: string, @Query('tenantId') tenantId?: string) {
    return this.cases.origin(req.user, id, tenantId);
  }
}
