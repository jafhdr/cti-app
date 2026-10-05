import { Type } from 'class-transformer';
import { IsArray, IsBoolean, IsEmail, IsEnum, IsOptional, IsString, MinLength, ValidateNested } from 'class-validator';
import type { ModuleAccessInput, UserRole } from './users.types';

export class CreateUserDto {
  @IsString() @MinLength(1) name!: string;
  @IsEmail() email!: string;
  @IsString() @MinLength(8) password!: string;
  @IsEnum(['SUPER_ADMIN', 'ADMIN', 'USER']) role!: UserRole;
  @IsOptional() @IsString() tenantId?: string;
}

export class UpdateRoleDto {
  @IsEnum(['SUPER_ADMIN', 'ADMIN', 'USER']) role!: UserRole;
}

export class UpdateProfileDto {
  @IsString() @MinLength(1) name!: string;
  @IsEmail() email!: string;
}

export class ResetUserPasswordDto {
  @IsString() @MinLength(8) password!: string;
}

export class UpdateUserStatusDto {
  @IsBoolean() isActive!: boolean;
}

class ModuleAssignmentDto implements ModuleAccessInput {
  @IsString() @MinLength(1) moduleId!: string;
  @IsOptional() @IsArray() @IsString({ each: true }) featureKeys?: string[];
}

export class UpdateUserModuleAccessDto {
  @IsArray() @ValidateNested({ each: true }) @Type(() => ModuleAssignmentDto)
  access!: ModuleAssignmentDto[];
}
