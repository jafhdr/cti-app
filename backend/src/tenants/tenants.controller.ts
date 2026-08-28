import { Body, Controller, Get, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { AuthUser } from '../users/users.types';
import { TenantsService } from './tenants.service';

@Controller('tenants')
@UseGuards(AuthGuard, RolesGuard)
@Roles('SUPER_ADMIN')
export class TenantsController {
  constructor(private readonly tenants: TenantsService) {}

  @Get()
  list() { return this.tenants.list(); }

  @Post()
  create(@Req() req: { user: AuthUser }, @Body() body: { name: string; slug: string; adminName: string; adminEmail: string; adminPassword: string }) {
    return this.tenants.create(req.user, body);
  }

  @Patch(':id/status')
  updateStatus(@Req() req: { user: AuthUser }, @Param('id') id: string, @Body() body: { isActive: boolean }) {
    return this.tenants.updateStatus(req.user, id, body.isActive);
  }
}
