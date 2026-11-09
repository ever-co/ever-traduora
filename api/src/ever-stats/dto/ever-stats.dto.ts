import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean } from 'class-validator';

/** `PUT /api/v1/ever-stats/enabled`: the operator's statistics switch. */
export class SetStatsEnabledRequest {
  @ApiProperty({ description: 'Whether this installation sends anonymous usage statistics' })
  @IsBoolean()
  enabled: boolean;
}

/** The state of the anonymous usage statistics, as the settings page shows it. */
export class EverStatsStatusDTO {
  @ApiProperty({ description: 'Whether reports are sent: the module is loaded, the switch is on and the destination is usable' })
  enabled: boolean;

  @ApiProperty({ enum: ['env', 'ui', 'cloud-managed'], description: 'Why: the environment (default), the operator switch, or Ever Cloud' })
  reason: 'env' | 'ui' | 'cloud-managed';

  @ApiProperty()
  toggleEnabled: boolean;

  @ApiProperty()
  toggleReadOnly: boolean;

  @ApiProperty()
  destinationUsable: boolean;

  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true })
  nextSendAt: string | null;

  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true })
  lastSentAt: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  lastStatus: string | null;

  @ApiProperty({ description: 'After an answer 422, nothing is sent until the module is upgraded' })
  refusedUntilUpgrade: boolean;

  @ApiProperty({ description: 'The anonymous id of this installation' })
  instanceId: string;

  @ApiProperty({ description: 'The id of the statistics public key' })
  keyId: string;

  @ApiProperty({ enum: ['ok', 'secret_missing', 'key_unreadable'] })
  keyState: string;

  @ApiProperty()
  country: string;

  @ApiProperty()
  installSource: string;

  @ApiProperty()
  version: string;

  @ApiProperty()
  channel: string;

  @ApiProperty()
  moduleVersion: string;
}

/** A stored report: the exact bytes sent, their signature, the date and the answer. */
export class EverStatsReportDTO {
  @ApiProperty()
  reportId: string;

  @ApiProperty()
  period: string;

  @ApiProperty()
  final: boolean;

  @ApiProperty({ description: 'The exact bytes sent, as text' })
  payload: string;

  @ApiProperty()
  signature: string;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt: string;

  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true })
  sentAt: string | null;

  @ApiPropertyOptional({ type: Number, nullable: true })
  httpStatus: number | null;

  @ApiProperty({ enum: ['pending', 'sent', 'rejected', 'failed'] })
  status: string;

  @ApiProperty()
  attempts: number;

  @ApiPropertyOptional({ type: String, nullable: true })
  error: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  hint: string | null;
}
