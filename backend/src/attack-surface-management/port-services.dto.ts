import { NetworkProtocol, PortDiscoveryStatus } from '@prisma/client';
import { IsEnum, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

export class RecordPortServiceDto {
  @IsInt()
  @Min(1)
  @Max(65535)
  port!: number;

  @IsEnum(NetworkProtocol)
  protocol!: NetworkProtocol;

  @IsOptional()
  @IsString()
  service?: string;

  @IsOptional() @IsString() @MaxLength(160)
  product?: string;

  @IsOptional() @IsString() @MaxLength(80)
  version?: string;

  @IsOptional() @IsString() @MaxLength(2000)
  banner?: string;

  @IsOptional() @IsString() @MaxLength(160)
  source?: string;

  @IsEnum(PortDiscoveryStatus)
  status!: PortDiscoveryStatus;
}
