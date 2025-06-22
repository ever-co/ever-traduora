import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsEmail, IsEnum, IsHexColor, IsNotEmpty, IsOptional, IsString, Length, Validate } from 'class-validator';
import { Transform } from 'class-transformer';
import { InviteStatus } from '../entity/invite.entity';
import { ProjectRole } from '../entity/project-user.entity';
import { IsNotOnlyWhitespace } from '../validators/IsNotOnlyWhitespace';
import { IsValidLabel } from '../validators/IsValidLabel';

export interface JwtPayload {
  sub: string;
  type: string;
}

export enum GrantType {
  Password = 'password',
  ClientCredentials = 'client_credentials',
  // TODO: is this part of the oauth2 spec? Investigate alternatives for authenticating tokens
  Provider = 'provider',
}

export class NewUserDTO {
  @ApiProperty()
  id: string;

  @ApiProperty()
  name: string;

  @ApiProperty()
  email: string;

  @ApiProperty()
  accessToken: string;
}

export class UserInfoDTO {
  @ApiProperty()
  id: string;

  @ApiProperty()
  name: string;

  @ApiProperty()
  email: string;
}

export class AccessTokenDTO {
  @ApiProperty()
  access_token: string;
  @ApiProperty()
  expires_in: string;
  @ApiProperty()
  token_type: string;
}

export class ImportTermsDTO {
  @ApiProperty()
  added: number;
  @ApiProperty()
  skipped: number;
}

export class ImportTranslationsDTO {
  @ApiProperty()
  upserted: number;
}

export class ImportFileDTO {
  @ApiProperty()
  terms: ImportTermsDTO;

  @ApiProperty()
  translations: ImportTranslationsDTO;
}

export class LocaleDTO {
  @ApiProperty()
  code: string;
  @ApiProperty()
  language: string;
  @ApiProperty()
  region: string;
}

export class AccessDatesDTO {
  @ApiProperty()
  created: string;
  @ApiProperty()
  modified: string;
}

export class ProjectDTO {
  @ApiProperty()
  id: string;
  @ApiProperty()
  name: string;
  @ApiProperty()
  description: string;
  @ApiProperty()
  localesCount: number;
  @ApiProperty()
  termsCount: number;
  @ApiProperty({ enum: ProjectRole })
  role: ProjectRole;
  @ApiProperty()
  date: AccessDatesDTO;
}

export class ProjectPlanDTO {
  @ApiProperty()
  code: string;
  @ApiProperty()
  name: string;
  @ApiProperty()
  maxStrings: number;
  @ApiProperty()
  date: AccessDatesDTO;
}

export class ProjectUserDTO {
  @ApiProperty()
  id: string;
  @ApiProperty()
  name: string;
  @ApiProperty()
  email: string;
  @ApiProperty({ enum: ProjectRole })
  role: ProjectRole;
}

export class ProjectInviteDto {
  @ApiProperty()
  id: string;
  @ApiProperty({ enum: InviteStatus })
  status: InviteStatus;
  @ApiProperty()
  email: string;
  @ApiProperty({ enum: ProjectRole })
  role: ProjectRole;
}

export class ProjectInviteAddedUserDto {
  @ApiProperty()
  userId: string;
  @ApiProperty()
  name: string;
  @ApiProperty()
  email: string;
  @ApiProperty({ enum: ProjectRole })
  role: ProjectRole;
}

export class ProjectTermDTO {
  @ApiProperty()
  id: string;
  @ApiProperty()
  value: string;
  @ApiProperty({
    nullable: true,
  })
  context: string | null;
  @ApiProperty()
  labels: ProjectLabelDTO[];
  @ApiProperty()
  date: AccessDatesDTO;
}

export class ProjectLabelDTO {
  @ApiProperty()
  id: string;
  @ApiProperty()
  value: string;
  @ApiProperty()
  color: string;
}

export class ProjectStatsDTO {
  @ApiProperty()
  progress: number;
  @ApiProperty()
  translated: number;
  @ApiProperty()
  total: number;
  @ApiProperty()
  terms: number;
  @ApiProperty()
  locales: number;
}

export class ProjectLocaleStatsDTO {
  @ApiProperty()
  progress: number;
  @ApiProperty()
  translated: number;
  @ApiProperty()
  total: number;
}

export class GetProjectStatsDTO {
  @ApiProperty()
  projectStats: ProjectStatsDTO;
  @ApiProperty()
  localeStats: { [localeCode: string]: ProjectLocaleStatsDTO };
}

export class ProjectLocaleDTO {
  @ApiProperty()
  id: string;
  @ApiProperty()
  locale: LocaleDTO;
  @ApiProperty()
  date: AccessDatesDTO;
}

export class TermTranslationDTO {
  @ApiProperty()
  termId: string;
  @ApiProperty()
  value: string;
  @ApiProperty()
  labels: ProjectLabelDTO[];
  @ApiProperty()
  date: AccessDatesDTO;
}

export class ProjectClientDTO {
  @ApiProperty()
  id: string;
  @ApiProperty()
  name: string;
  @ApiProperty({ enum: ProjectRole })
  role: ProjectRole;
}

export class AuthProviderDTO {
  @ApiProperty()
  slug: string;
  @ApiProperty()
  clientId: string;
  @ApiProperty()
  url: string;
  @ApiProperty()
  redirectUrl: string;
}

export class ProjectClientWithSecretDTO {
  @ApiProperty()
  id: string;
  @ApiProperty()
  name: string;
  @ApiProperty({ enum: ProjectRole })
  role: ProjectRole;
  @ApiProperty()
  secret: string;
}

export abstract class ServiceApiResponse<A> {
  abstract get data(): A;
}

export class ListProjectClientsResponse extends ServiceApiResponse<ProjectClientDTO[]> {
  @ApiProperty({ type: ProjectClientDTO, isArray: true })
  data: ProjectClientDTO[];
}

export class ProjectClientResponse extends ServiceApiResponse<ProjectClientDTO> {
  @ApiProperty()
  data: ProjectClientDTO;
}

export class ProjectClientWithSecretResponse extends ServiceApiResponse<ProjectClientWithSecretDTO> {
  @ApiProperty()
  data: ProjectClientWithSecretDTO;
}

export class ProjectStatsResponse extends ServiceApiResponse<GetProjectStatsDTO> {
  @ApiProperty()
  data: GetProjectStatsDTO;
}

export class SignupResponse extends ServiceApiResponse<NewUserDTO> {
  @ApiProperty()
  data: NewUserDTO;
}

export class ListAuthProvidersResponse extends ServiceApiResponse<AuthProviderDTO[]> {
  @ApiProperty({ type: AuthProviderDTO, isArray: true })
  data: AuthProviderDTO[];
}

export class ImportResponse extends ServiceApiResponse<ImportFileDTO> {
  @ApiProperty()
  data: ImportFileDTO;
}

export class UserInfoResponse extends ServiceApiResponse<UserInfoDTO> {
  @ApiProperty()
  data: UserInfoDTO;
}

export class ProjectResponse extends ServiceApiResponse<ProjectDTO> {
  @ApiProperty()
  data: ProjectDTO;
}

export class ProjectPlanResponse extends ServiceApiResponse<ProjectPlanDTO> {
  @ApiProperty()
  data: ProjectPlanDTO;
}

export class ListTermTranslatonsResponse extends ServiceApiResponse<TermTranslationDTO[]> {
  @ApiProperty({ type: TermTranslationDTO, isArray: true })
  data: TermTranslationDTO[];
}

export class TermTranslatonResponse extends ServiceApiResponse<TermTranslationDTO> {
  @ApiProperty()
  data: TermTranslationDTO;
}

export class ListProjectsResponse extends ServiceApiResponse<ProjectDTO[]> {
  @ApiProperty({ type: ProjectDTO, isArray: true })
  data: ProjectDTO[];
}

export class ListProjectLocalesResponse extends ServiceApiResponse<ProjectLocaleDTO[]> {
  @ApiProperty({ type: ProjectLocaleDTO, isArray: true })
  data: ProjectLocaleDTO[];
}

export class ProjectLocaleResponse extends ServiceApiResponse<ProjectLocaleDTO> {
  @ApiProperty()
  data: ProjectLocaleDTO;
}

export class ProjectTermResponse extends ServiceApiResponse<ProjectTermDTO> {
  @ApiProperty()
  data: ProjectTermDTO;
}

export class ListProjectLabelsResponse extends ServiceApiResponse<ProjectLabelDTO[]> {
  @ApiProperty({ type: ProjectLabelDTO, isArray: true })
  data: ProjectLabelDTO[];
}

export class ProjectLabelResponse extends ServiceApiResponse<ProjectLabelDTO> {
  @ApiProperty()
  data: ProjectLabelDTO;
}

export class ListProjectTermsResponse extends ServiceApiResponse<ProjectTermDTO[]> {
  @ApiProperty({ type: ProjectTermDTO, isArray: true })
  data: ProjectTermDTO[];
}

export class ListLocalesResponse extends ServiceApiResponse<LocaleDTO[]> {
  @ApiProperty({ type: LocaleDTO, isArray: true })
  data: LocaleDTO[];
}

export class ListProjectUsersResponse extends ServiceApiResponse<ProjectUserDTO[]> {
  @ApiProperty({ type: ProjectUserDTO, isArray: true })
  data: ProjectUserDTO[];
}

export class ProjectUserResponse extends ServiceApiResponse<ProjectUserDTO> {
  @ApiProperty()
  data: ProjectUserDTO;
}

export class ListInviteUsersResponse extends ServiceApiResponse<ProjectInviteDto[]> {
  @ApiProperty({ type: ProjectInviteDto, isArray: true })
  data: ProjectInviteDto[];
}

export class ProjectInviteResponse extends ServiceApiResponse<ProjectInviteDto> {
  @ApiProperty()
  data: ProjectInviteDto;
}

export class ProjectInviteCreatedResponse extends ServiceApiResponse<ProjectInviteDto | ProjectInviteAddedUserDto> {
  @ApiProperty()
  data: ProjectInviteDto | ProjectInviteAddedUserDto;
}

export class SignupRequest {
  @ApiProperty({ minLength: 8, maxLength: 255 })
  @Length(2, 255)
  @Validate(IsNotOnlyWhitespace)
  name: string;

  @ApiProperty()
  @IsEmail()
  email: string;

  @ApiProperty({ minLength: 8, maxLength: 255 })
  @Length(8, 255)
  password: string;
}

export class AuthenticateRequest {
  @ApiProperty({ enum: GrantType })
  @IsEnum(GrantType)
  grant_type: GrantType;

  // username & password
  @ApiPropertyOptional()
  @IsEmail()
  @IsOptional()
  username: string;

  @ApiPropertyOptional({ minLength: 8, maxLength: 255 })
  @Length(8, 255)
  @IsOptional()
  password: string;

  // client credentials
  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  client_id: string;

  @Length(8, 255)
  @ApiPropertyOptional({ minLength: 8, maxLength: 255 })
  @IsOptional()
  client_secret: string;

  // provider
  @IsString()
  @IsOptional()
  code: string;
}

export class InviteUserRequest {
  @IsEmail()
  email: string;

  @IsEnum(ProjectRole)
  role: ProjectRole;
}

export class UpdateProjectUserRequest {
  @ApiProperty({ enum: ProjectRole })
  @IsEnum(ProjectRole)
  role: ProjectRole;
}

export class UpdateProjectInviteRequest {
  @IsEnum(ProjectRole)
  role: ProjectRole;
}

export class AddProjectClientRequest {
  @IsString()
  @Length(1, 255)
  @ApiProperty({ minLength: 1, maxLength: 255 })
  name: string;

  @ApiProperty({ enum: ProjectRole })
  @IsEnum(ProjectRole)
  role: ProjectRole;
}

export class UpdateProjectClientRequest {
  @ApiProperty({ enum: ProjectRole })
  @IsEnum(ProjectRole)
  role: ProjectRole;
}

export class UpdateUserDataRequest {
  @Length(2, 255)
  @ApiPropertyOptional({ minLength: 2, maxLength: 255 })
  @Validate(IsNotOnlyWhitespace)
  @IsOptional()
  name?: string;

  @ApiPropertyOptional()
  @IsEmail()
  @IsOptional()
  email?: string;
}

export class ForgotPasswordRequest {
  @IsEmail()
  @ApiProperty()
  email: string;
}

export class ChangePasswordRequest {
  @Length(8, 255)
  @ApiProperty({ minLength: 8, maxLength: 255 })
  oldPassword: string;

  @Length(8, 255)
  @ApiProperty({ minLength: 8, maxLength: 255 })
  newPassword: string;
}

export class ResetPasswordRequest {
  @IsEmail()
  @ApiProperty()
  email: string;

  @IsNotEmpty()
  @ApiProperty()
  token: string;

  @Length(8, 255)
  @ApiProperty({ minLength: 8, maxLength: 255 })
  newPassword: string;
}

export class CreateProjectRequest {
  @Length(1, 255)
  @ApiProperty({ minLength: 1, maxLength: 255 })
  @Validate(IsNotOnlyWhitespace)
  name: string;

  @IsOptional()
  @Length(0, 255)
  @ApiPropertyOptional({ minLength: 0, maxLength: 255 })
  description: string;
}

export class UpdateProjectRequest {
  @ApiPropertyOptional({ minLength: 1, maxLength: 255 })
  @IsOptional()
  @Length(1, 255)
  @Validate(IsNotOnlyWhitespace)
  name: string | undefined;

  @ApiPropertyOptional({ minLength: 0, maxLength: 255 })
  @IsOptional()
  @Length(0, 255)
  description: string | undefined;
}

export class AddLabelRequest {
  @ApiProperty({ minLength: 1, maxLength: 255 })
  @Length(1, 255)
  @Validate(IsValidLabel)
  value: string;

  @ApiProperty({ minLength: 7, maxLength: 7 })
  @Length(7, 7)
  @Validate(IsHexColor)
  color: string;
}

export class UpdateLabelRequest {
  @ApiProperty({ minLength: 1, maxLength: 255 })
  @Length(1, 255)
  @Validate(IsValidLabel)
  value: string;

  @ApiProperty({ minLength: 7, maxLength: 7 })
  @Length(7, 7)
  @Validate(IsHexColor)
  color: string;
}

export class AddTermRequest {
  @ApiProperty({ minLength: 1, maxLength: 255 })
  @Length(1, 255)
  @Validate(IsNotOnlyWhitespace)
  value: string;

  @ApiPropertyOptional({ minLength: 0, maxLength: 1000 })
  @IsOptional()
  @Length(0, 1000)
  context: string | undefined;
}

export class UpdateTermRequest {
  @ApiProperty({ minLength: 1, maxLength: 255 })
  @Length(1, 255)
  @Validate(IsNotOnlyWhitespace)
  value: string;

  @ApiPropertyOptional({ minLength: 0, maxLength: 1000 })
  @IsOptional()
  @Length(0, 1000)
  context: string | undefined;
}

export class AddLocaleRequest {
  @ApiProperty({ minLength: 2, maxLength: 16 })
  @Length(2, 16)
  code: string;
}

export class UpdateProjectPlanRequest {
  @IsNotEmpty()
  @ApiProperty()
  planId: string;
}

export class UpdateTranslationRequest {
  @IsNotEmpty()
  @ApiProperty()
  termId: string;

  @Length(0, 8192)
  @ApiProperty({ minLength: 0, maxLength: 8192 })
  value: string;
}

export enum ImportExportFormat {
  AndroidXml = 'androidxml',
  Csv = 'csv',
  Xliff12 = 'xliff12',
  JsonFlat = 'jsonflat',
  JsonNested = 'jsonnested',
  YamlFlat = 'yamlflat',
  YamlNested = 'yamlnested',
  Properties = 'properties',
  Gettext = 'po',
  Strings = 'strings',
  Php = 'php',
  ResX = 'resx',
}

export class ExportQuery {
  @Length(2, 16)
  @ApiProperty({ minLength: 2, maxLength: 16 })
  locale: string;

  @Length(2, 16)
  @ApiProperty({ minLength: 2, maxLength: 16 })
  @IsOptional()
  fallbackLocale: string;

  @IsBoolean()
  @Transform(({ value }) => value === 'true' || value === true)
  @ApiProperty()
  @IsOptional()
  untranslated: boolean;

  @IsEnum(ImportExportFormat)
  @ApiProperty({ enum: ImportExportFormat })
  format: ImportExportFormat;
}

export class ImportQuery {
  @Length(2, 16)
  @ApiProperty({ minLength: 2, maxLength: 16 })
  locale: string;

  @IsEnum(ImportExportFormat)
  @ApiProperty({ enum: ImportExportFormat })
  format: ImportExportFormat;
}
