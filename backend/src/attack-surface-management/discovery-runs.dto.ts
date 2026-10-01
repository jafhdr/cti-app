import { IsBoolean, IsInt, Max, Min } from 'class-validator';
export class UpdateDiscoveryScheduleDto {
  @IsBoolean()
  enabled!: boolean;
  @IsInt() @Min(60) @Max(43_200)
  intervalMinutes!: number;
}
