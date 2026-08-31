import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { AuthGuard } from './auth.guard';
import { RolesGuard } from './roles.guard';
import { ModuleAccessGuard } from './module-access.guard';
import { PrismaService } from '../prisma.service';

@Module({
  imports: [JwtModule.register({})],
  controllers: [AuthController],
  providers: [AuthService, AuthGuard, RolesGuard, ModuleAccessGuard, PrismaService],
  exports: [AuthGuard, RolesGuard, ModuleAccessGuard, JwtModule],
})
export class AuthModule {}
