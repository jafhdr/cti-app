import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { AuthGuard } from '../auth/auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { DashboardService } from './dashboard.service';
import { AuthUser } from '../users/users.types';

@ApiTags('dashboard')
@Controller('dashboard')
@UseGuards(AuthGuard, RolesGuard)
export class DashboardController {
  constructor(private dashboard: DashboardService) {}

  @Get('summary')
  @Roles('SUPER_ADMIN', 'ADMIN', 'USER')
  summary(@Req() req: Request & { user: AuthUser }) {
    return this.dashboard.getSummary(req.user);
  }
}
