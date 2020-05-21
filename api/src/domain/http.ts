import { ApiModelProperty, ApiModelPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsEnum, IsHexColor, IsNotEmpty, IsOptional, IsString, Length, Validate } from 'class-validator';
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
  @ApiModelProperty()
  id: string;

  @ApiModelProperty()
  name: string;

  @ApiModelProperty()
  email: string;

  @ApiModelProperty()
  accessToken: string;
}

export class UserInfoDTO {
  @ApiModelProperty()
  id: string;

  @ApiModelProperty()
  name: string;

  @ApiModelProperty()
  email: string;
}

export class AccessTokenDTO {
  @ApiModelProperty()
  access_token: string;
  @ApiModelProperty()
  expires_in: string;
  @ApiModelProperty()
  token_type: string;
}

export class ImportTermsDTO {
  @ApiModelProperty()
  added: number;
  @ApiModelProperty()
  skipped: number;
}

export class ImportTranslationsDTO {
  @ApiModelProperty()
  upserted: number;
}

export class ImportFileDTO {
  @ApiModelProperty()
  terms: ImportTermsDTO;

  @ApiModelProperty()
  translations: ImportTranslationsDTO;
}

export class LocaleDTO {
  @ApiModelProperty()
  code: string;
  @ApiModelProperty()
  language: string;
  @ApiModelProperty()
  region: string;
}

export class AccessDatesDTO {
  @ApiModelProperty()
  created: string;
  @ApiModelProperty()
  modified: string;
}

export class ProjectDTO {
  @ApiModelProperty()
  id: string;
  @ApiModelProperty()
  name: string;
  @ApiModelProperty()
  description: string;
  @ApiModelProperty()
  localesCount: number;
  @ApiModelProperty()
  termsCount: number;
  @ApiModelProperty({ enum: ProjectRole })
  role: ProjectRole;
  @ApiModelProperty()
  date: AccessDatesDTO;
}

export class ProjectPlanDTO {
  @ApiModelProperty()
  code: string;
  @ApiModelProperty()
  name: string;
  @ApiModelProperty()
  maxStrings: number;
  @ApiModelProperty()
  date: AccessDatesDTO;
}

export class ProjectUserDTO {
  @ApiModelProperty()
  id: string;
  @ApiModelProperty()
  name: string;
  @ApiModelProperty()
  email: string;
  @ApiModelProperty({ enum: ProjectRole })
  role: ProjectRole;
}

export class ProjectInviteDto {
  @ApiModelProperty()
  id: string;
  @ApiModelProperty({ enum: InviteStatus })
  status: InviteStatus;
  @ApiModelProperty()
  email: string;
  @ApiModelProperty({ enum: ProjectRole })
  role: ProjectRole;
}

export class ProjectInviteAddedUserDto {
  @ApiModelProperty()
  userId: string;
  @ApiModelProperty()
  name: string;
  @ApiModelProperty()
  email: string;
  @ApiModelProperty({ enum: ProjectRole })
  role: ProjectRole;
}

export class ProjectTermDTO {
  @ApiModelProperty()
  id: string;
  @ApiModelProperty()
  value: string;
  @ApiModelProperty()
  labels: ProjectLabelDTO[];
  @ApiModelProperty()
  date: AccessDatesDTO;
}

export class ProjectLabelDTO {
  @ApiModelProperty()
  id: string;
  @ApiModelProperty()
  value: string;
  @ApiModelProperty()
  color: string;
}

export class ProjectStatsDTO {
  @ApiModelProperty()
  progress: number;
  @ApiModelProperty()
  translated: number;
  @ApiModelProperty()
  total: number;
  @ApiModelProperty()
  terms: number;
  @ApiModelProperty()
  locales: number;
}

export class ProjectLocaleStatsDTO {
  @ApiModelProperty()
  progress: number;
  @ApiModelProperty()
  translated: number;
  @ApiModelProperty()
  total: number;
}

export class GetProjectStatsDTO {
  @ApiModelProperty()
  projectStats: ProjectStatsDTO;
  @ApiModelProperty()
  localeStats: { [localeCode: string]: ProjectLocaleStatsDTO };
}

export class ProjectLocaleDTO {
  @ApiModelProperty()
  id: string;
  @ApiModelProperty()
  locale: LocaleDTO;
  @ApiModelProperty()
  date: AccessDatesDTO;
}

export class TermTranslationDTO {
  @ApiModelProperty()
  termId: string;
  @ApiModelProperty()
  value: string;
  @ApiModelProperty()
  labels: ProjectLabelDTO[];
  @ApiModelProperty()
  date: AccessDatesDTO;
}

export class ProjectClientDTO {
  @ApiModelProperty()
  id: string;
  @ApiModelProperty()
  name: string;
  @ApiModelProperty({ enum: ProjectRole })
  role: ProjectRole;
}

export class AuthProviderDTO {
  @ApiModelProperty()
  slug: string;
  @ApiModelProperty()
  clientId: string;
  @ApiModelProperty()
  url: string;
  @ApiModelProperty()
  redirectUrl: string;
}

export class ProjectClientWithSecretDTO {
  @ApiModelProperty()
  id: string;
  @ApiModelProperty()
  name: string;
  @ApiModelProperty({ enum: ProjectRole })
  role: ProjectRole;
  @ApiModelProperty()
  secret: string;
}

export abstract class ServiceApiResponse<A> {
  abstract get data(): A;
}

export class ListProjectClientsResponse extends ServiceApiResponse<ProjectClientDTO[]> {
  @ApiModelProperty({ type: ProjectClientDTO, isArray: true })
  data: ProjectClientDTO[];
}

export class ProjectClientResponse extends ServiceApiResponse<ProjectClientDTO> {
  @ApiModelProperty()
  data: ProjectClientDTO;
}

export class ProjectClientWithSecretResponse extends ServiceApiResponse<ProjectClientWithSecretDTO> {
  @ApiModelProperty()
  data: ProjectClientWithSecretDTO;
}

export class ProjectStatsResponse extends ServiceApiResponse<GetProjectStatsDTO> {
  @ApiModelProperty()
  data: GetProjectStatsDTO;
}

export class SignupResponse extends ServiceApiResponse<NewUserDTO> {
  @ApiModelProperty()
  data: NewUserDTO;
}

export class ListAuthProvidersResponse extends ServiceApiResponse<AuthProviderDTO[]> {
  @ApiModelProperty({ type: AuthProviderDTO, isArray: true })
  data: AuthProviderDTO[];
}

export class ImportResponse extends ServiceApiResponse<ImportFileDTO> {
  @ApiModelProperty()
  data: ImportFileDTO;
}

export class UserInfoResponse extends ServiceApiResponse<UserInfoDTO> {
  @ApiModelProperty()
  data: UserInfoDTO;
}

export class ProjectResponse extends ServiceApiResponse<ProjectDTO> {
  @ApiModelProperty()
  data: ProjectDTO;
}

export class ProjectPlanResponse extends ServiceApiResponse<ProjectPlanDTO> {
  @ApiModelProperty()
  data: ProjectPlanDTO;
}

export class ListTermTranslatonsResponse extends ServiceApiResponse<TermTranslationDTO[]> {
  @ApiModelProperty({ type: TermTranslationDTO, isArray: true })
  data: TermTranslationDTO[];
}

export class TermTranslatonResponse extends ServiceApiResponse<TermTranslationDTO> {
  @ApiModelProperty()
  data: TermTranslationDTO;
}

export class ListProjectsResponse extends ServiceApiResponse<ProjectDTO[]> {
  @ApiModelProperty({ type: ProjectDTO, isArray: true })
  data: ProjectDTO[];
}

export class ListProjectLocalesResponse extends ServiceApiResponse<ProjectLocaleDTO[]> {
  @ApiModelProperty({ type: ProjectLocaleDTO, isArray: true })
  data: ProjectLocaleDTO[];
}

export class ProjectLocaleResponse extends ServiceApiResponse<ProjectLocaleDTO> {
  @ApiModelProperty()
  data: ProjectLocaleDTO;
}

export class ProjectTermResponse extends ServiceApiResponse<ProjectTermDTO> {
  @ApiModelProperty()
  data: ProjectTermDTO;
}

export class ListProjectLabelsResponse extends ServiceApiResponse<ProjectLabelDTO[]> {
  @ApiModelProperty({ type: ProjectLabelDTO, isArray: true })
  data: ProjectLabelDTO[];
}

export class ProjectLabelResponse extends ServiceApiResponse<ProjectLabelDTO> {
  @ApiModelProperty()
  data: ProjectLabelDTO;
}

export class ListProjectTermsResponse extends ServiceApiResponse<ProjectTermDTO[]> {
  @ApiModelProperty({ type: ProjectTermDTO, isArray: true })
  data: ProjectTermDTO[];
}

export class ListLocalesResponse extends ServiceApiResponse<LocaleDTO[]> {
  @ApiModelProperty({ type: LocaleDTO, isArray: true })
  data: LocaleDTO[];
}

export class ListProjectUsersResponse extends ServiceApiResponse<ProjectUserDTO[]> {
  @ApiModelProperty({ type: ProjectUserDTO, isArray: true })
  data: ProjectUserDTO[];
}

export class ProjectUserResponse extends ServiceApiResponse<ProjectUserDTO> {
  @ApiModelProperty()
  data: ProjectUserDTO;
}

export class ListInviteUsersResponse extends ServiceApiResponse<ProjectInviteDto[]> {
  @ApiModelProperty({ type: ProjectInviteDto, isArray: true })
  data: ProjectInviteDto[];
}

export class ProjectInviteResponse extends ServiceApiResponse<ProjectInviteDto> {
  @ApiModelProperty()
  data: ProjectInviteDto;
}

export class ProjectInviteCreatedResponse extends ServiceApiResponse<ProjectInviteDto | ProjectInviteAddedUserDto> {
  @ApiModelProperty()
  data: ProjectInviteDto | ProjectInviteAddedUserDto;
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
  grant_type: GrantType;

  // username & password
  @ApiModelPropertyOptional()
  @IsEmail()
  @IsOptional()
  username: string;

  @ApiModelPropertyOptional({ minLength: 8, maxLength: 255 })
  @Length(8, 255)
  @IsOptional()
  password: string;

  // client credentials
  @ApiModelPropertyOptional()
  @IsString()
  @IsOptional()
  client_id: string;

  @Length(8, 255)
  @ApiModelPropertyOptional({ minLength: 8, maxLength: 255 })
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
  @ApiModelProperty({ enum: ProjectRole })
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

export class AddLabelRequest {
  @ApiModelProperty({ minLength: 1, maxLength: 255 })
  @Length(1, 255)
  @Validate(IsValidLabel)
  value: string;

  @ApiModelProperty({ minLength: 7, maxLength: 7 })
  @Length(7, 7)
  @Validate(IsHexColor)
  color: string;
}

export class UpdateLabelRequest {
  @ApiModelProperty({ minLength: 1, maxLength: 255 })
  @Length(1, 255)
  @Validate(IsValidLabel)
  value: string;

  @ApiModelProperty({ minLength: 7, maxLength: 7 })
  @Length(7, 7)
  @Validate(IsHexColor)
  color: string;
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
