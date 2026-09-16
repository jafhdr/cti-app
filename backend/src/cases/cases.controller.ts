import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { ModuleAccessGuard } from '../auth/module-access.guard';
import { RequiresModule } from '../auth/module-access.decorator';
import { AuthUser } from '../users/users.types';
import { CasesService } from './cases.service';
import { CreateCaseInput, UpdateCaseInput, ListCaseQuery } from './cases.types';

@Controller('cases')
@UseGuards(AuthGuard, RolesGuard, ModuleAccessGuard)
@RequiresModule('case-management')
export class CasesController {
  constructor(private readonly casesService: CasesService) {}

  @Get()
  @Roles('SUPER_ADMIN', 'ADMIN', 'USER')
  list(@Req() req: { user: AuthUser }, @Query() query: ListCaseQuery) {
    return this.casesService.list(req.user, query);
  }

  @Get(':id')
  @Roles('SUPER_ADMIN', 'ADMIN', 'USER')
  getDetail(@Req() req: { user: AuthUser }, @Param('id') id: string) {
    return this.casesService.getDetail(req.user, id);
  }

  @Post()
  @Roles('SUPER_ADMIN', 'ADMIN')
  create(@Req() req: { user: AuthUser }, @Body() body: CreateCaseInput) {
    return this.casesService.create(req.user, body);
  }

  @Patch(':id')
  @Roles('SUPER_ADMIN', 'ADMIN')
  update(@Req() req: { user: AuthUser }, @Param('id') id: string, @Body() body: UpdateCaseInput) {
    return this.casesService.update(req.user, id, body);
  }

  @Delete(':id')
  @Roles('SUPER_ADMIN', 'ADMIN')
  delete(@Req() req: { user: AuthUser }, @Param('id') id: string) {
    return this.casesService.delete(req.user, id);
  }

  @Post(':id/assign')
  @Roles('SUPER_ADMIN', 'ADMIN')
  assign(@Req() req: { user: AuthUser }, @Param('id') id: string, @Body() body: { assigneeId: string }) {
    return this.casesService.assign(req.user, id, body.assigneeId);
  }

  @Get('assignable-users')
  @Roles('SUPER_ADMIN', 'ADMIN', 'USER')
  getAssignableUsers(@Req() req: { user: AuthUser }, @Query('tenantId') tenantId?: string) {
    return this.casesService.getAssignableUsers(req.user, tenantId);
  }
}
