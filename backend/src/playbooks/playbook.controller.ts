import { BadRequestException, Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { ModuleAccessGuard } from '../auth/module-access.guard';
import { RequiresModule, RequiresModuleFeature } from '../auth/module-access.decorator';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import type { AuthUser } from '../users/users.types';
import { decidePlaybookSchema, recoverSandboxSchema, triggerPlaybookSchema } from './playbook.dto';
import { PlaybookService } from './playbook.service';
import { SandboxConnectorService } from './sandbox-connector.service';

@Controller('playbooks')
@UseGuards(AuthGuard, RolesGuard, ModuleAccessGuard)
@RequiresModule('threat-intelligence')
@RequiresModuleFeature('indicator-management')
export class PlaybookController {
  constructor(private readonly playbooks: PlaybookService, private readonly sandbox: SandboxConnectorService) {}

  @Get('runs/:id/sandbox') @Roles('SUPER_ADMIN', 'ADMIN', 'USER')
  sandboxDetail(@Req() req: { user: AuthUser }, @Param('id') id: string, @Query('tenantId') tenantId?: string) {
    return this.sandbox.detail(req.user, id, tenantId);
  }

  @Post('runs/:id/sandbox/execute') @Roles('SUPER_ADMIN', 'ADMIN')
  sandboxExecute(@Req() req: { user: AuthUser }, @Param('id') id: string, @Query('tenantId') tenantId?: string) {
    return this.sandbox.enqueue(req.user, id, 'BLOCK_DOMAIN', tenantId);
  }

  @Post('runs/:id/sandbox/rollback') @Roles('SUPER_ADMIN', 'ADMIN')
  sandboxRollback(@Req() req: { user: AuthUser }, @Param('id') id: string, @Query('tenantId') tenantId?: string) {
    return this.sandbox.enqueue(req.user, id, 'UNBLOCK_DOMAIN', tenantId);
  }

  @Post('runs/:id/sandbox/recover-rollback') @Roles('SUPER_ADMIN', 'ADMIN')
  recoverRollback(@Req() req: { user: AuthUser }, @Param('id') id: string, @Body() body: unknown, @Query('tenantId') tenantId?: string) {
    const parsed = recoverSandboxSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    return this.sandbox.recoverRollback(req.user, id, parsed.data, tenantId);
  }

  @Post('runs/:id/sandbox/abort') @Roles('SUPER_ADMIN', 'ADMIN')
  sandboxAbort(@Req() req: { user: AuthUser }, @Param('id') id: string, @Query('tenantId') tenantId?: string) {
    return this.sandbox.abort(req.user, id, tenantId);
  }

  @Get('capabilities') @Roles('SUPER_ADMIN', 'ADMIN', 'USER')
  capabilities() { return this.playbooks.capabilities(); }

  @Get('eligible-alerts') @Roles('SUPER_ADMIN', 'ADMIN', 'USER')
  eligibleAlerts(@Req() req: { user: AuthUser }, @Query('tenantId') tenantId?: string) { return this.playbooks.eligibleAlerts(req.user, tenantId); }

  @Get('runs') @Roles('SUPER_ADMIN', 'ADMIN', 'USER')
  list(@Req() req: { user: AuthUser }, @Query('tenantId') tenantId?: string) {
    return this.playbooks.list(req.user, tenantId);
  }

  @Get('runs/:id') @Roles('SUPER_ADMIN', 'ADMIN', 'USER')
  get(@Req() req: { user: AuthUser }, @Param('id') id: string, @Query('tenantId') tenantId?: string) {
    return this.playbooks.get(req.user, id, tenantId);
  }

  @Post('runs') @Roles('SUPER_ADMIN', 'ADMIN')
  trigger(@Req() req: { user: AuthUser }, @Body() body: unknown, @Query('tenantId') tenantId?: string) {
    const parsed = triggerPlaybookSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    return this.playbooks.trigger(req.user, parsed.data, tenantId);
  }

  @Post('runs/:id/decisions') @Roles('SUPER_ADMIN', 'ADMIN')
  decide(@Req() req: { user: AuthUser }, @Param('id') id: string, @Body() body: unknown, @Query('tenantId') tenantId?: string) {
    const parsed = decidePlaybookSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    return this.playbooks.decide(req.user, id, parsed.data, tenantId);
  }

  @Post('runs/:id/execute') @Roles('SUPER_ADMIN', 'ADMIN')
  execute(@Req() req: { user: AuthUser }, @Param('id') id: string, @Query('tenantId') tenantId?: string) {
    return this.playbooks.execute(req.user, id, tenantId);
  }

  @Post('runs/:id/verify') @Roles('SUPER_ADMIN', 'ADMIN')
  verify(@Req() req: { user: AuthUser }, @Param('id') id: string, @Query('tenantId') tenantId?: string) {
    return this.playbooks.verify(req.user, id, tenantId);
  }

  @Post('runs/:id/retry') @Roles('SUPER_ADMIN', 'ADMIN')
  retry(@Req() req: { user: AuthUser }, @Param('id') id: string, @Query('tenantId') tenantId?: string) {
    return this.playbooks.retry(req.user, id, tenantId);
  }
}
