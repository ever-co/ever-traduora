import { IsEmail, IsEnum, IsNotEmpty, IsOptional, IsString, Length, Validate } from 'class-validator';

import { ProjectRole } from '../entity/project-user.entity';
import { IsNotOnlyWhitespace } from '../validators/IsNotOnlyWhitespace';
import { ApiModelProperty, ApiModelPropertyOptional } from '@nestjs/swagger';

export interface JwtPayload {
  sub: string;
  type: string;
}

export enum GrantType {
  Password = 'password',
  ClientCredentials = 'client_credentials',
}

export class SignupRequest {
  @ApiModelProperty({ minLength: 8, maxLength: 255 })
  @Length(2, 255)
  @Validate(IsNotOnlyWhitespace)
  name: string;

  @ApiModelProperty()
  @IsEmail()
  email: string;

  @ApiModelProperty({ minLength: 8, maxLength: 255 })
  @Length(8, 255)
  password: string;
}

export class AuthenticateRequest {
  @ApiModelProperty({ enum: GrantType })
  @IsEnum(GrantType)
  grantType: GrantType;

  // username & password
  @ApiModelPropertyOptional()
  @IsEmail()
  @IsOptional()
  email: string;

  @ApiModelPropertyOptional({ minLength: 8, maxLength: 255 })
  @Length(8, 255)
  @IsOptional()
  password: string;

  // client credentials
  @ApiModelPropertyOptional()
  @IsString()
  @IsOptional()
  clientId: string;

  @Length(8, 255)
  @ApiModelPropertyOptional({ minLength: 8, maxLength: 255 })
  @IsOptional()
  clientSecret: string;
}

export class AddProjectUserRequest {
  @ApiModelProperty()
  @IsEmail()
  email: string;

  @ApiModelProperty({ enum: ProjectRole })
  @IsEnum(ProjectRole)
  role: ProjectRole;
}

export class UpdateProjectUserRequest {
  @ApiModelProperty({ enum: ProjectRole })
  @IsEnum(ProjectRole)
  role: ProjectRole;
}

export class AddProjectClientRequest {
  @IsString()
  @Length(1, 255)
  @ApiModelProperty({ minLength: 1, maxLength: 255 })
  name: string;

  @ApiModelProperty({ enum: ProjectRole })
  @IsEnum(ProjectRole)
  role: ProjectRole;
}

export class UpdateProjectClientRequest {
  @ApiModelProperty({ enum: ProjectRole })
  @IsEnum(ProjectRole)
  role: ProjectRole;
}

export class UpdateUserDataRequest {
  @Length(2, 255)
  @ApiModelPropertyOptional({ minLength: 2, maxLength: 255 })
  @Validate(IsNotOnlyWhitespace)
  @IsOptional()
  name?: string;

  @ApiModelPropertyOptional()
  @IsEmail()
  @IsOptional()
  email?: string;
}

export class ForgotPasswordRequest {
  @IsEmail()
  @ApiModelProperty()
  email: string;
}

export class ChangePasswordRequest {
  @Length(8, 255)
  @ApiModelProperty({ minLength: 8, maxLength: 255 })
  oldPassword: string;

  @Length(8, 255)
  @ApiModelProperty({ minLength: 8, maxLength: 255 })
  newPassword: string;
}

export class ResetPasswordRequest {
  @IsEmail()
  @ApiModelProperty()
  email: string;

  @IsNotEmpty()
  @ApiModelProperty()
  token: string;

  @Length(8, 255)
  @ApiModelProperty({ minLength: 8, maxLength: 255 })
  newPassword: string;
}

export class CreateProjectRequest {
  @Length(1, 255)
  @ApiModelProperty({ minLength: 1, maxLength: 255 })
  @Validate(IsNotOnlyWhitespace)
  name: string;

  @IsOptional()
  @Length(0, 255)
  @ApiModelPropertyOptional({ minLength: 0, maxLength: 255 })
  description: string;
}

export class UpdateProjectRequest {
  @ApiModelPropertyOptional({ minLength: 1, maxLength: 255 })
  @IsOptional()
  @Length(1, 255)
  @Validate(IsNotOnlyWhitespace)
  name: string | undefined;

  @ApiModelPropertyOptional({ minLength: 0, maxLength: 255 })
  @IsOptional()
  @Length(0, 255)
  description: string | undefined;
}

export class AddTermRequest {
  @ApiModelProperty({ minLength: 1, maxLength: 255 })
  @Length(1, 255)
  @Validate(IsNotOnlyWhitespace)
  value: string;
}

export class UpdateTermRequest {
  @ApiModelProperty({ minLength: 1, maxLength: 255 })
  @Length(1, 255)
  @Validate(IsNotOnlyWhitespace)
  value: string;
}

export class AddLocaleRequest {
  @ApiModelProperty({ minLength: 2, maxLength: 16 })
  @Length(2, 16)
  code: string;
}

export class UpdateProjectPlanRequest {
  @IsNotEmpty()
  @ApiModelProperty()
  planId: string;
}

export class UpdateTranslationRequest {
  @IsNotEmpty()
  @ApiModelProperty()
  termId: string;

  @Length(0, 8192)
  @ApiModelProperty({ minLength: 0, maxLength: 8192 })
  value: string;
}

export enum ImportExportFormat {
  Csv = 'csv',
  Xliff12 = 'xliff12',
  JsonFlat = 'jsonflat',
  JsonNested = 'jsonnested',
  YamlFlat = 'yamlflat',
  YamlNested = 'yamlnested',
  Properties = 'properties',
  Gettext = 'po',
  Strings = 'strings',
}

export class ExportQuery {
  @Length(2, 16)
  @ApiModelProperty({ minLength: 2, maxLength: 16 })
  locale: string;

  @IsEnum(ImportExportFormat)
  @ApiModelProperty({ enum: ImportExportFormat })
  format: ImportExportFormat;
}

export class ImportQuery {
  @Length(2, 16)
  @ApiModelProperty({ minLength: 2, maxLength: 16 })
  locale: string;

  @IsEnum(ImportExportFormat)
  @ApiModelProperty({ enum: ImportExportFormat })
  format: ImportExportFormat;
}
