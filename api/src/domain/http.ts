import { IsBoolean, IsEmail, IsEnum, IsIn, IsNotEmpty, IsOptional, IsString, Length, Validate } from 'class-validator';
import { ProjectRole } from '../entity/project-user.entity';
import { IsNotOnlyWhitespace } from '../validators/IsNotOnlyWhitespace';

export interface JwtPayload {
  sub: string;
  type: string;
}

export enum GrantType {
  Password = 'password',
  ClientCredentials = 'client_credentials',
}

export const KNOWN_TOS_AND_PRIVACY_VERSION = ['09.12.18'];

export class SignupRequest {
  @Length(2, 255)
  @Validate(IsNotOnlyWhitespace)
  name: string;

  @IsEmail()
  email: string;

  @Length(8, 255)
  password: string;

  @IsBoolean()
  acceptedTosAndPrivacy: boolean;

  @IsString()
  @Length(1, 255)
  @IsIn(KNOWN_TOS_AND_PRIVACY_VERSION)
  acceptedTosAndPrivacyVersion: string;
}

export class AuthenticateRequest {
  @IsEnum(GrantType)
  grantType: GrantType;

  // username & password
  @IsEmail()
  @IsOptional()
  email: string;

  @Length(8, 255)
  @IsOptional()
  password: string;

  // client credentials
  @IsString()
  @IsOptional()
  clientId: string;

  @Length(8, 255)
  @IsOptional()
  clientSecret: string;
}

export class AddProjectUserRequest {
  @IsEmail()
  email: string;

  @IsEnum(ProjectRole)
  role: ProjectRole;
}

export class UpdateProjectUserRequest {
  @IsEnum(ProjectRole)
  role: ProjectRole;
}

export class AddProjectClientRequest {
  @IsString()
  @Length(1, 255)
  name: string;

  @IsEnum(ProjectRole)
  role: ProjectRole;
}

export class UpdateProjectClientRequest {
  @IsEnum(ProjectRole)
  role: ProjectRole;
}

export class UpdateUserDataRequest {
  @Length(2, 255)
  @Validate(IsNotOnlyWhitespace)
  @IsOptional()
  name?: string;

  @IsEmail()
  @IsOptional()
  email?: string;
}

export class ForgotPasswordRequest {
  @IsEmail()
  email: string;
}

export class ChangePasswordRequest {
  @Length(8, 255)
  oldPassword: string;

  @Length(8, 255)
  newPassword: string;
}

export class ResetPasswordRequest {
  @IsEmail()
  email: string;

  @IsNotEmpty()
  token: string;

  @Length(8, 255)
  newPassword: string;
}

export class CreateProjectRequest {
  @Length(1, 255)
  @Validate(IsNotOnlyWhitespace)
  name: string;

  @IsOptional()
  @Length(0, 255)
  description: string;
}

export class UpdateProjectRequest {
  @IsOptional()
  @Length(1, 255)
  @Validate(IsNotOnlyWhitespace)
  name: string | undefined;

  @IsOptional()
  @Length(0, 255)
  description: string | undefined;
}

export class AddTermRequest {
  @Length(1, 255)
  @Validate(IsNotOnlyWhitespace)
  value: string;
}

export class UpdateTermRequest {
  @Length(1, 255)
  @Validate(IsNotOnlyWhitespace)
  value: string;
}

export class AddLocaleRequest {
  @Length(2, 16)
  code: string;
}

export class UpdateProjectPlanRequest {
  @IsNotEmpty()
  planId: string;
}

export class UpdateTranslationRequest {
  @IsNotEmpty()
  termId: string;

  @Length(0, 8192)
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
}

export class ExportQuery {
  @Length(2, 16)
  locale: string;

  @IsEnum(ImportExportFormat)
  format: ImportExportFormat;
}

export class ImportQuery {
  @Length(2, 16)
  locale: string;

  @IsEnum(ImportExportFormat)
  format: ImportExportFormat;
}
