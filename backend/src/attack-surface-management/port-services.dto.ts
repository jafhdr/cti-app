import { NetworkProtocol, PortDiscoveryStatus } from '@prisma/client';
import { IsEnum, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

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

  @IsEnum(PortDiscoveryStatus)
  status!: PortDiscoveryStatus;
}
