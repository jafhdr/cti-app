import { Body, Controller, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { AuthUser } from '../users/users.types';
import { IndicatorInput } from './indicators.types';
import { IndicatorsService } from './indicators.service';

@Controller('indicators')
@UseGuards(AuthGuard, RolesGuard)
export class IndicatorsController {
  constructor(private readonly indicators: IndicatorsService) {}

  @Get()
  @Roles('SUPER_ADMIN', 'ADMIN', 'USER')
  list(@Req() req: { user: AuthUser }, @Query() query: Record<string, string | undefined>) { return this.indicators.list(req.user, query); }

  @Post()
  @Roles('SUPER_ADMIN', 'ADMIN')
  create(@Req() req: { user: AuthUser }, @Body() body: IndicatorInput) { return this.indicators.create(req.user, body); }

  @Patch(':id')
  @Roles('SUPER_ADMIN', 'ADMIN')
  update(@Req() req: { user: AuthUser }, @Param('id') id: string, @Body() body: IndicatorInput) { return this.indicators.update(req.user, id, body); }

  @Patch(':id/deactivate')
  @Roles('SUPER_ADMIN', 'ADMIN')
  deactivate(@Req() req: { user: AuthUser }, @Param('id') id: string) { return this.indicators.deactivate(req.user, id); }
}
