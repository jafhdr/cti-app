import { Body, Controller, Get, Param, Post, Put, Delete, Req, UseGuards, Query } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { AuthUser } from '../users/users.types';
import { ModulesService } from './modules.service';
import {
  CreateModuleDto,
  UpdateModuleDto,
  CreateModuleEntitlementDto,
  UpdateModuleEntitlementDto,
  AssignModuleToTenantDto,
  UpdateTenantModuleDto,
  CreateGlobalConfigDto,
  UpdateModuleHealthDto,
} from './modules.types';

@Controller('modules')
@UseGuards(AuthGuard, RolesGuard)
@Roles('SUPER_ADMIN')
export class ModulesController {
  constructor(private readonly modules: ModulesService) {}

  // Global Module Catalog
  @Get()
  findAll() {
    return this.modules.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.modules.findOne(id);
  }

  // Create Module
  @Post()
  create(@Req() req: { user: AuthUser }, @Body() dto: CreateModuleDto) {
    return this.modules.create(req.user, dto);
  }

  // Update Module
  @Put(':id')
  update(@Req() req: { user: AuthUser }, @Param('id') id: string, @Body() dto: UpdateModuleDto) {
    return this.modules.update(req.user, id, dto);
  }

  // Delete Module
  @Delete(':id')
  delete(@Req() req: { user: AuthUser }, @Param('id') id: string) {
    return this.modules.delete(req.user, id);
  }

  // Enable/Disable Module Globally
  @Post(':id/toggle-global')
  toggleGlobalStatus(@Req() req: { user: AuthUser }, @Param('id') id: string, @Body() body: { isEnabled: boolean }) {
    return this.modules.toggleGlobalStatus(req.user, id, body.isEnabled);
  }

  // Module Entitlement per Plan
  @Post('entitlements')
  createEntitlement(@Req() req: { user: AuthUser }, @Body() dto: CreateModuleEntitlementDto) {
    return this.modules.createEntitlement(req.user, dto);
  }

  @Put('entitlements/:id')
  updateEntitlement(@Req() req: { user: AuthUser }, @Param('id') id: string, @Body() dto: UpdateModuleEntitlementDto) {
    return this.modules.updateEntitlement(req.user, id, dto);
  }

  @Delete('entitlements/:id')
  deleteEntitlement(@Req() req: { user: AuthUser }, @Param('id') id: string) {
    return this.modules.deleteEntitlement(req.user, id);
  }

  // Assign Module to Tenant
  @Post('assign')
  assignToTenant(@Req() req: { user: AuthUser }, @Body() dto: AssignModuleToTenantDto) {
    return this.modules.assignToTenant(req.user, dto);
  }

  @Put('tenants/:tenantId/modules/:moduleId')
  updateTenantModule(
    @Req() req: { user: AuthUser },
    @Param('tenantId') tenantId: string,
    @Param('moduleId') moduleId: string,
    @Body() dto: UpdateTenantModuleDto
  ) {
    return this.modules.updateTenantModule(req.user, tenantId, moduleId, dto);
  }

  @Delete('tenants/:tenantId/modules/:moduleId')
  removeTenantModule(
    @Req() req: { user: AuthUser },
    @Param('tenantId') tenantId: string,
    @Param('moduleId') moduleId: string
  ) {
    return this.modules.removeTenantModule(req.user, tenantId, moduleId);
  }

  // Global Module Configuration
  @Post('config')
  createGlobalConfig(@Req() req: { user: AuthUser }, @Body() dto: CreateGlobalConfigDto) {
    return this.modules.createGlobalConfig(req.user, dto);
  }

  @Put('config/:key')
  updateGlobalConfig(@Req() req: { user: AuthUser }, @Param('key') key: string, @Body() body: { value: Record<string, any> }) {
    return this.modules.updateGlobalConfig(req.user, key, body.value);
  }

  @Get('config')
  getGlobalConfigs(@Query('moduleId') moduleId?: string) {
    return this.modules.getGlobalConfigs(moduleId);
  }

  // Module Health Monitoring
  @Post('health')
  updateModuleHealth(@Body() dto: UpdateModuleHealthDto & { moduleId: string }) {
    const { moduleId, ...healthData } = dto;
    return this.modules.updateModuleHealth(moduleId, healthData);
  }

  @Get('health')
  getModuleHealth() {
    return this.modules.getModuleHealth();
  }

  // Global Usage Monitoring
  @Get('usage')
  getUsageMonitoring(@Query('tenantId') tenantId?: string) {
    return this.modules.getUsageMonitoring(tenantId);
  }

  // Global Audit Log for Modules
  @Get('audit-logs')
  getModuleAuditLogs(@Query('moduleId') moduleId?: string, @Query('limit') limit?: string) {
    return this.modules.getModuleAuditLogs(moduleId, limit ? parseInt(limit, 10) : 100);
  }

  // Tenant Override
  @Post('tenants/:tenantId/modules/:moduleId/override')
  overrideTenantModule(
    @Req() req: { user: AuthUser },
    @Param('tenantId') tenantId: string,
    @Param('moduleId') moduleId: string,
    @Body() body: { isEnabled: boolean; reason: string }
  ) {
    return this.modules.overrideTenantModule(req.user, tenantId, moduleId, body.isEnabled, body.reason);
  }
}
