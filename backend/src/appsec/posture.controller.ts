import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { ModuleAccessGuard } from '../auth/module-access.guard';
import { RequiresModule, RequiresModuleFeature } from '../auth/module-access.decorator';
import type { AuthUser } from '../users/users.types';
import { TenantQueryDto } from './appsec.dto';
import { PostureService } from './posture.service';

@Controller('appsec/posture')
@UseGuards(AuthGuard, RolesGuard, ModuleAccessGuard)
@RequiresModule('appsec-posture')
@RequiresModuleFeature('posture-overview')
export class PostureController {
  constructor(private readonly posture: PostureService) {}
  @Get() @Roles('SUPER_ADMIN', 'ADMIN', 'USER')
  get(@Req() req: { user: AuthUser }, @Query() query: TenantQueryDto) { return this.posture.get(req.user, query.tenantId); }
}
