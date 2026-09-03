import { Body, Controller, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '../auth/auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { type AuthUser } from '../users/users.types';
import { SubscriptionService } from './subscription.service';
import { type CreateSubscriptionInput, type UpdateSubscriptionStatusInput } from './subscription.types';

@ApiTags('subscription')
@Controller('subscription')
@UseGuards(AuthGuard, RolesGuard)
@Roles('SUPER_ADMIN', 'ADMIN')
export class SubscriptionController {
  constructor(private readonly subscription: SubscriptionService) {}

  @Get('packages')
  @ApiOperation({ summary: 'Daftar paket dan katalog harga modul' })
  packages() { return this.subscription.listPackages(); }

  @Get('my')
  @ApiOperation({ summary: 'Subscription aktif untuk tenant' })
  my(@Req() req: { user: AuthUser }, @Query('tenantId') tenantId?: string) { return this.subscription.getMy(req.user, tenantId); }

  @Post()
  @ApiOperation({ summary: 'Buat atau ganti subscription tenant' })
  subscribe(@Req() req: { user: AuthUser }, @Body() body: CreateSubscriptionInput) { return this.subscription.subscribe(req.user, body); }

  @Patch('status')
  @Roles('SUPER_ADMIN')
  @ApiOperation({ summary: 'Ubah status subscription tenant' })
  status(@Req() req: { user: AuthUser }, @Body() body: UpdateSubscriptionStatusInput) { return this.subscription.updateStatus(req.user, body); }

  @Get('modules/:code/price')
  @ApiOperation({ summary: 'Harga modul pada katalog custom' })
  price(@Param('code') code: string) { return this.subscription.modulePrice(code); }
}
