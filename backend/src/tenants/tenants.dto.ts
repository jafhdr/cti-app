import { IsBoolean, IsEmail, IsString, Matches, MinLength } from 'class-validator';

export class CreateTenantDto {
  @IsString() @MinLength(1) name!: string;
  @IsString() @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/) slug!: string;
  @IsString() @MinLength(1) adminName!: string;
  @IsEmail() adminEmail!: string;
  @IsString() @MinLength(8) adminPassword!: string;
}

export class UpdateTenantStatusDto {
  @IsBoolean() isActive!: boolean;
}
