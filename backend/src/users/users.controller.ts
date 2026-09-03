import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { AuthGuard } from '../auth/auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { UsersService } from './users.service';
import { AuthUser, BulkModuleAccessInput, UserRole } from './users.types';

@ApiTags('users')
@Controller('users')
@UseGuards(AuthGuard, RolesGuard)
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  // GET /users
  @Get()
  @Roles('SUPER_ADMIN', 'ADMIN')
  findAll(@Req() req: { user: AuthUser }, @Query('tenantId') tenantId?: string) {
    return this.usersService.findAll(req.user, tenantId);
  }

  // GET /users/tenants
  @Get('tenants')
  @Roles('SUPER_ADMIN')
  findTenants(@Req() req: { user: AuthUser }) {
    return this.usersService.findTenants();
  }

  // POST /users
  @Post()
  @Roles('SUPER_ADMIN', 'ADMIN')
  create(
    @Req() req: { user: AuthUser },
    @Body()
    body: {
      name: string;
      email: string;
      password: string;
      role: UserRole;
      tenantId?: string;
    },
  ) {
    return this.usersService.create(req.user, body);
  }

  // PATCH /users/:id/role
  @Patch(':id/role')
  @Roles('SUPER_ADMIN', 'ADMIN')
  updateRole(
    @Req() req: { user: AuthUser },
    @Param('id') userId: string,
    @Body() body: { role: UserRole },
  ) {
    return this.usersService.updateRole(
      req.user,
      userId,
      body.role,
    );
  }

  @Patch(':id')
  @Roles('SUPER_ADMIN', 'ADMIN')
  updateProfile(
    @Req() req: { user: AuthUser },
    @Param('id') userId: string,
    @Body() body: { name: string; email: string },
  ) {
    return this.usersService.updateProfile(req.user, userId, body);
  }

  @Patch(':id/password')
  @Roles('SUPER_ADMIN', 'ADMIN')
  resetPassword(
    @Req() req: { user: AuthUser },
    @Param('id') userId: string,
    @Body() body: { password: string },
  ) {
    return this.usersService.resetPassword(req.user, userId, body.password);
  }

  @Patch(':id/status')
  @Roles('SUPER_ADMIN', 'ADMIN')
  updateStatus(
    @Req() req: { user: AuthUser },
    @Param('id') userId: string,
    @Body() body: { isActive: boolean },
  ) {
    return this.usersService.updateStatus(req.user, userId, body.isActive);
  }

  @Get(':id/module-access')
  @Roles('SUPER_ADMIN', 'ADMIN')
  @ApiOperation({ summary: 'Daftar modul subscription dan assignment user' })
  getModuleAccess(@Req() req: { user: AuthUser }, @Param('id') userId: string) {
    return this.usersService.getModuleAccess(req.user, userId);
  }

  @Put(':id/module-access')
  @Roles('SUPER_ADMIN', 'ADMIN')
  @ApiOperation({ summary: 'Ganti seluruh assignment modul user' })
  updateModuleAccess(
    @Req() req: { user: AuthUser },
    @Param('id') userId: string,
    @Body() body: { access: Array<{ moduleId: string; featureKeys?: string[] }> },
  ) {
    return this.usersService.updateModuleAccess(req.user, userId, body.access);
  }

  @Get('tenant/:tenantId/module-access')
  @Roles('SUPER_ADMIN', 'ADMIN')
  @ApiOperation({ summary: 'Daftar semua user dan assignment modul dalam tenant' })
  listTenantModuleAccess(@Req() req: { user: AuthUser }, @Param('tenantId') tenantId: string) {
    return this.usersService.listTenantUserModuleAccess(req.user, tenantId);
  }

  @Patch('tenant/:tenantId/module-access')
  @Roles('SUPER_ADMIN', 'ADMIN')
  @ApiOperation({ summary: 'Ganti assignment modul untuk beberapa user' })
  bulkModuleAccess(@Req() req: { user: AuthUser }, @Param('tenantId') tenantId: string, @Body() body: BulkModuleAccessInput) {
    return this.usersService.bulkUpdateModuleAccess(req.user, tenantId, body);
  }
}

@ApiTags('modules')
@Controller('modules')
@UseGuards(AuthGuard, RolesGuard)
export class ModuleUserAccessController {
  constructor(private readonly usersService: UsersService) {}

  @Get(':moduleId/user-access')
  @Roles('SUPER_ADMIN', 'ADMIN')
  @ApiOperation({ summary: 'Daftar user yang memiliki akses ke modul' })
  listModuleUserAccess(@Req() req: { user: AuthUser }, @Param('moduleId') moduleId: string, @Query('tenantId') tenantId?: string) {
    return this.usersService.listModuleUserAccess(req.user, moduleId, tenantId);
  }
}
