import { Body, Controller, Get, HttpCode, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Access, CurrentPrincipal, Public, RequestMeta, type RequestMetaInfo } from '../../common/decorators';
import type { Principal } from '../../common/principal';
import { AuthService } from './auth.service';
import { ChangePasswordDto, LoginDto, OtpRequestDto, OtpVerifyDto, PasswordResetDto, RefreshDto, UpdateProfileDto } from './auth.dto';

const STRICT = { default: { limit: 10, ttl: 60_000 } };

@ApiTags('Auth')
@Controller({ path: 'auth', version: '1' })
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Throttle(STRICT)
  @Post('login')
  @HttpCode(200)
  @ApiOperation({ summary: 'Sign in (staff, brand users and heroes) with phone/email + password' })
  login(@Body() dto: LoginDto, @RequestMeta() meta: RequestMetaInfo) {
    return this.auth.login(dto.identifier, dto.password, meta);
  }

  @Public()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Post('refresh')
  @HttpCode(200)
  @ApiOperation({ summary: 'Rotate the refresh token and get a new access token' })
  refresh(@Body() dto: RefreshDto, @RequestMeta() meta: RequestMetaInfo) {
    return this.auth.refresh(dto.refreshToken, meta);
  }

  @Public()
  @Post('logout')
  @HttpCode(200)
  logout(@Body() dto: RefreshDto) {
    return this.auth.logout(dto.refreshToken);
  }

  @ApiBearerAuth()
  @Access({ actors: ['staff', 'brand', 'courier'] })
  @Get('me')
  me(@CurrentPrincipal() p: Principal) {
    return this.auth.profile(p.kind === 'user' ? p.userId : '');
  }

  @ApiBearerAuth()
  @Access({ actors: ['staff', 'brand', 'courier'] })
  @Patch('me')
  updateMe(@CurrentPrincipal() p: Principal, @Body() dto: UpdateProfileDto) {
    return this.auth.updateProfile(p.kind === 'user' ? p.userId : '', dto);
  }

  @ApiBearerAuth()
  @Access({ actors: ['staff', 'brand', 'courier'] })
  @Throttle(STRICT)
  @Post('change-password')
  @HttpCode(200)
  changePassword(@CurrentPrincipal() p: Principal, @Body() dto: ChangePasswordDto) {
    return this.auth.changePassword(p.kind === 'user' ? p.userId : '', dto.currentPassword, dto.newPassword);
  }

  @ApiBearerAuth()
  @Access({ actors: ['staff', 'brand', 'courier'] })
  @Post('logout-all')
  @HttpCode(200)
  logoutAll(@CurrentPrincipal() p: Principal) {
    return this.auth.logoutAll(p.kind === 'user' ? p.userId : '');
  }

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('password/forgot')
  @HttpCode(200)
  @ApiOperation({ summary: 'Send a password reset code by SMS' })
  forgot(@Body() dto: OtpRequestDto) {
    return this.auth.requestPasswordReset(dto.phone);
  }

  @Public()
  @Throttle(STRICT)
  @Post('password/reset')
  @HttpCode(200)
  reset(@Body() dto: PasswordResetDto) {
    return this.auth.resetPassword(dto.phone, dto.code, dto.newPassword);
  }

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('customer/otp')
  @HttpCode(200)
  @ApiOperation({ summary: 'Customer portal: send a login code to the recipient phone' })
  customerOtp(@Body() dto: OtpRequestDto) {
    return this.auth.customerOtpRequest(dto.phone, dto.trackingNumber);
  }

  @Public()
  @Throttle(STRICT)
  @Post('customer/verify')
  @HttpCode(200)
  @ApiOperation({ summary: 'Customer portal: verify the code and get a customer session token' })
  customerVerify(@Body() dto: OtpVerifyDto) {
    return this.auth.customerOtpVerify(dto.phone, dto.code, dto.trackingNumber);
  }
}
