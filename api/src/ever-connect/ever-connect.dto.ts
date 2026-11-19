import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';

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
