import { Body, Controller, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { ModuleAccessGuard } from '../auth/module-access.guard';
import { RequiresModule, RequiresModuleFeature } from '../auth/module-access.decorator';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import type { AuthUser } from '../users/users.types';
import { CreateFeedbackFollowUpDto, ListFeedbackFollowUpsDto, TransitionFeedbackFollowUpDto, UpdateFeedbackFollowUpDto } from './feedback-follow-ups.dto';
import { FeedbackFollowUpsService } from './feedback-follow-ups.service';

@Controller('intelligence/feedback-follow-ups')
@UseGuards(AuthGuard, RolesGuard, ModuleAccessGuard)
@RequiresModule('threat-intelligence')
@RequiresModuleFeature('intelligence-hub')
@Roles('SUPER_ADMIN', 'ADMIN')
export class FeedbackFollowUpsController {
  constructor(private readonly service: FeedbackFollowUpsService) {}
  @Get('review') review(@Req() req: { user: AuthUser }, @Query() query: ListFeedbackFollowUpsDto) { return this.service.review(req.user, query); }
  @Get() list(@Req() req: { user: AuthUser }, @Query() query: ListFeedbackFollowUpsDto) { return this.service.list(req.user, query); }
  @Get(':id') get(@Req() req: { user: AuthUser }, @Param('id') id: string, @Query('tenantId') tenantId?: string) { return this.service.get(req.user, id, tenantId); }
  @Post('from-feedback/:feedbackId') create(@Req() req: { user: AuthUser }, @Param('feedbackId') feedbackId: string, @Body() body: CreateFeedbackFollowUpDto, @Query('tenantId') tenantId?: string) { return this.service.create(req.user, feedbackId, body, tenantId); }
  @Patch(':id') update(@Req() req: { user: AuthUser }, @Param('id') id: string, @Body() body: UpdateFeedbackFollowUpDto, @Query('tenantId') tenantId?: string) { return this.service.update(req.user, id, body, tenantId); }
  @Patch(':id/status') transition(@Req() req: { user: AuthUser }, @Param('id') id: string, @Body() body: TransitionFeedbackFollowUpDto, @Query('tenantId') tenantId?: string) { return this.service.transition(req.user, id, body, tenantId); }
}
