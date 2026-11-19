import { ApiProperty } from '@nestjs/swagger';
import { ArrayMaxSize, IsArray, IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';

/** Connect with a code an organization owner or admin created in app.ever.co. */
export class EverConnectConnectRequest {
  @ApiProperty({ description: 'The connect code, EVC-XXXX-XXXX-XXXX' })
  @IsString()
  @MaxLength(32)
  code: string;

  @ApiProperty({ description: 'The name the organization sees for this installation', required: false })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  displayName?: string;
}

/** The operator's answer to an installation-wide integration an organization consented to. */
export class EverConnectAcceptRequest {
  @ApiProperty({ description: 'Accept (true) or decline (false)' })
  @IsBoolean()
  accepted: boolean;
}

/** The public address of this installation, for the `instance_url` integration. */
export class EverConnectPublicUrlRequest {
  @ApiProperty({ description: 'An absolute https address' })
  @IsString()
  @MaxLength(2048)
  url: string;
}

/** The operator's opt-in to maintenance operations requested from app.ever.co. */
export class EverConnectManagedRequest {
  @ApiProperty({ description: 'Whether operations may run at all on this installation', required: false })
  @IsOptional()
  @IsBoolean()
  optIn?: boolean;

  @ApiProperty({ description: 'The kinds allowed: health_report, backup, restore_check (backups on SQLite only)', required: false })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(4)
  @IsString({ each: true })
  kinds?: string[];

  @ApiProperty({ description: 'Weekly windows in UTC: [{days: [0-6], from: "HH:MM", to: "HH:MM"}]', required: false })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(14)
  windows?: Array<{ days: number[]; from: string; to: string }>;

  @ApiProperty({ description: 'The absolute directory backups are written to (never shown again; empty removes it)', required: false })
  @IsOptional()
  @IsString()
  @MaxLength(1024)
  backupDir?: string;
}
