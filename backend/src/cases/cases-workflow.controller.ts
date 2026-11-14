import { Body, Controller, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { ModuleAccessGuard } from '../auth/module-access.guard';
import { RequiresModule, RequiresModuleFeature } from '../auth/module-access.decorator';
import type { AuthUser } from '../users/users.types';
import { CaseTenantGuard } from './case-tenant.guard';
import { CaseClosedMutationGuard } from './case-closed-mutation.guard';
import { CasesWorkflowService } from './cases-workflow.service';
import { CreateCaseTaskInput, HandoffCaseInput, SetCaseDueDateInput, UpdateCaseTaskInput } from './case-workflow.types';

@Controller('cases')
@UseGuards(AuthGuard, RolesGuard, ModuleAccessGuard, CaseTenantGuard, CaseClosedMutationGuard)
@RequiresModule('case-management')
@RequiresModuleFeature('case-workflow', 'case-v2-workflow')
export class CasesWorkflowController {
  constructor(private readonly workflow: CasesWorkflowService) {}

  @Get(':id/workflow')
  @Roles('USER', 'ADMIN', 'SUPER_ADMIN')
  get(@Req() req: { user: AuthUser }, @Param('id') id: string, @Query('tenantId') tenantId?: string) {
    return this.workflow.get(req.user, id, tenantId);
  }

  @Post(':id/tasks')
  @Roles('ADMIN', 'SUPER_ADMIN')
  createTask(@Req() req: { user: AuthUser }, @Param('id') id: string, @Query('tenantId') tenantId: string | undefined, @Body() body: CreateCaseTaskInput) {
    return this.workflow.createTask(req.user, id, tenantId, body);
  }

  @Patch(':id/tasks/:taskId')
  @Roles('USER', 'ADMIN', 'SUPER_ADMIN')
  updateTask(@Req() req: { user: AuthUser }, @Param('id') id: string, @Param('taskId') taskId: string, @Query('tenantId') tenantId: string | undefined, @Body() body: UpdateCaseTaskInput) {
    return this.workflow.updateTask(req.user, id, taskId, tenantId, body);
  }

  @Post(':id/handoff')
  @Roles('ADMIN', 'SUPER_ADMIN')
  handoff(@Req() req: { user: AuthUser }, @Param('id') id: string, @Query('tenantId') tenantId: string | undefined, @Body() body: HandoffCaseInput) {
    return this.workflow.handoff(req.user, id, tenantId, body);
  }

  @Patch(':id/due-date')
  @Roles('ADMIN', 'SUPER_ADMIN')
  dueDate(@Req() req: { user: AuthUser }, @Param('id') id: string, @Query('tenantId') tenantId: string | undefined, @Body() body: SetCaseDueDateInput) {
    return this.workflow.dueDate(req.user, id, tenantId, body);
  }

}
