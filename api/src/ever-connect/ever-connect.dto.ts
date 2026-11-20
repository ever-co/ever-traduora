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

/**
 * The longest sealed confirmation: the API refuses an intent whose confirmation would be longer (422 intent_too_large),
 * and the confirm and reject routes take up to this length, so both sides agree.
 */
export const PROVISION_TXN_MAX = 16384;

/** A provisioning intent as app.ever.co put it in the link (a compact JWS). */
export class EverConnectProvisionIntentRequest {
  @ApiProperty({ description: 'The signed intent from app.ever.co (compact JWS)' })
  @IsString()
  @MaxLength(16384)
  intent: string;
}

/** The sealed confirmation `POST /provision/intent` answered. */
export class EverConnectProvisionConfirmRequest {
  @ApiProperty({ description: 'The sealed confirmation answered for the intent' })
  @IsString()
  // The largest the API seals (it refuses an intent whose confirmation would be longer)
  @MaxLength(PROVISION_TXN_MAX)
  provisionTxn: string;
}
