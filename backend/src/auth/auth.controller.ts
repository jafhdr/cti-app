import {
  Body, Controller, Get, Post, Req, Res, UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Request, Response } from 'express';
import type { CookieOptions } from 'express';
import { AuthService } from './auth.service';
import { AuthGuard } from './auth.guard';
import { LoginDto } from './dto/login.dto';
import { SignupDto } from './dto/signup.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private auth: AuthService) {}

  private cookieOptions(): CookieOptions {
    return { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/' };
  }

  private setSessionCookies(res: Response, result: any) {
    res.cookie('access_token', result.accessToken, {
      ...this.cookieOptions(), maxAge: 15 * 60 * 1000,
    });
    res.cookie('refresh_token', result.refreshToken, {
      ...this.cookieOptions(), maxAge: 7 * 24 * 60 * 60 * 1000,
    });
  }

  @Post('login')
  async login(@Body() dto: LoginDto, @Res({ passthrough: true }) res: Response) {
    const result = await this.auth.login(dto.email, dto.password);
    this.setSessionCookies(res, result);
    return { user: result.user };
  }

  @Post('signup')
  async signup(@Body() dto: SignupDto, @Res({ passthrough: true }) res: Response) {
    const result = await this.auth.signup(dto.name, dto.email, dto.password, dto.organization, dto.organizationSlug);
    this.setSessionCookies(res, result);
    return { user: result.user };
  }

  @Get('me')
  @UseGuards(AuthGuard)
  me(@Req() req: Request & { user: { sub: string } }) {
    return this.auth.me(req.user.sub);
  }

  @Post('refresh')
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const token = req.cookies?.refresh_token;
    const accessToken = await this.auth.refresh(token);
    res.cookie('access_token', accessToken, {
      ...this.cookieOptions(), maxAge: 15 * 60 * 1000,
    });
    return { ok: true };
  }

  @Post('forgot-password')
  forgotPassword(@Body() dto: ForgotPasswordDto) {
    return this.auth.forgotPassword(dto.email);
  }

  @Post('reset-password')
  resetPassword(@Body() dto: ResetPasswordDto) {
    return this.auth.resetPassword(dto.token, dto.password);
  }

  @Post('logout')
  logout(@Res({ passthrough: true }) res: Response) {
    res.clearCookie('access_token', this.cookieOptions());
    res.clearCookie('refresh_token', this.cookieOptions());
    return { ok: true };
  }
}
