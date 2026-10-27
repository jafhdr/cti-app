import { IsEnum, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { ReportRequirementAnswer } from '@prisma/client';

export class SendReportDto {
  @IsString() recipientId!: string;
  @IsOptional() @IsString() @MaxLength(1000) message?: string;
}

export class SubmitReportFeedbackDto {
  @IsInt() @Min(1) @Max(5) relevance!: number;
  @IsEnum(ReportRequirementAnswer) answeredRequirement!: ReportRequirementAnswer;
  @IsInt() @Min(1) @Max(5) actionability!: number;
  @IsOptional() @IsString() @MaxLength(3000) comments?: string;
  @IsOptional() @IsString() @MaxLength(3000) furtherIntelligenceRequest?: string;
}
