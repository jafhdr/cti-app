import { Body, Controller, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { ModuleAccessGuard } from '../auth/module-access.guard';
import { RequiresModule } from '../auth/module-access.decorator';
import { AuthUser } from '../users/users.types';
import { IndicatorInput } from './indicators.types';
import { IndicatorsService } from './indicators.service';
import { IndicatorFeedsService } from './indicator-feeds.service';
import { SyncIndicatorFeedsDto } from './indicator-feeds.types';

@Controller('indicators')
@UseGuards(AuthGuard, RolesGuard, ModuleAccessGuard)
@RequiresModule('threat-intelligence')
export class IndicatorsController {
  constructor(
    private readonly indicators: IndicatorsService,
    private readonly feeds: IndicatorFeedsService,
  ) {}

  @Get()
  @Roles('SUPER_ADMIN', 'ADMIN', 'USER')
  list(@Req() req: { user: AuthUser }, @Query() query: Record<string, string | undefined>) { return this.indicators.list(req.user, query); }

  @Post()
  @Roles('SUPER_ADMIN', 'ADMIN')
  create(@Req() req: { user: AuthUser }, @Body() body: IndicatorInput) { return this.indicators.create(req.user, body); }

  @Post('feed-sync')
  @Roles('SUPER_ADMIN', 'ADMIN')
  syncFeeds(@Req() req: { user: AuthUser }, @Body() body: SyncIndicatorFeedsDto) { return this.feeds.sync(req.user, body.tenantId); }

  @Patch(':id')
  @Roles('SUPER_ADMIN', 'ADMIN')
  update(@Req() req: { user: AuthUser }, @Param('id') id: string, @Body() body: IndicatorInput) { return this.indicators.update(req.user, id, body); }

  @Patch(':id/deactivate')
  @Roles('SUPER_ADMIN', 'ADMIN')
  deactivate(@Req() req: { user: AuthUser }, @Param('id') id: string) { return this.indicators.deactivate(req.user, id); }
}
