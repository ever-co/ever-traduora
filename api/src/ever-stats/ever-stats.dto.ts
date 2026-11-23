import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean } from 'class-validator';

/** The operator's switch on the Statistics page. */
export class EverStatsEnabledRequest {
  @ApiProperty({ description: 'Whether anonymous usage statistics are sent' })
  @IsBoolean()
  enabled: boolean;
}
