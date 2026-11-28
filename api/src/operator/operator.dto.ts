import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsIn, IsOptional, IsString, Length, Matches, MaxLength, Validate, ValidateNested } from 'class-validator';
import {
  AccessDatesDTO,
  OrganizationMemberDTO,
  OrganizationPlanDTO,
  OrganizationSeatsDTO,
  OrganizationStringsDTO,
  ServiceApiResponse,
} from '../domain/http';
import { OrganizationPlanCode, OrganizationStatus } from '../domain/organization-actions';
import { OperatorAuditAction } from '../entity/operator-audit.entity';
import { IsNotOnlyWhitespace } from '../validators/IsNotOnlyWhitespace';
import { REASON_MAX, REASON_MIN } from '../services/organization/organization-operator.service';

/** The requests and answers of P6 (DESIGN §3.9, §5): the operator console, organization export and deletion, account deletion. */

const PAGE_NUMBER = /^[1-9][0-9]{0,5}$/;

// Requests

export class OperatorPageQuery {
  @ApiPropertyOptional({ description: 'From 1', default: 1 })
  @IsOptional()
  @Matches(PAGE_NUMBER)
  page?: string;

  @ApiPropertyOptional({ description: '1 to 100', default: 25 })
  @IsOptional()
  @Matches(PAGE_NUMBER)
  limit?: string;
}

export class OperatorOrganizationsQuery extends OperatorPageQuery {
  @ApiPropertyOptional({ description: 'Part of the name or slug, part of the owner e-mail, or the exact id', maxLength: 100 })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;

  @ApiPropertyOptional({ enum: OrganizationStatus })
  @IsOptional()
  @IsIn(Object.values(OrganizationStatus))
  status?: OrganizationStatus;
}

export class OperatorAuditQuery extends OperatorPageQuery {
  @ApiPropertyOptional({ description: 'Only the actions on this organization' })
  @IsOptional()
  @IsString()
  @Length(1, 64)
  organizationId?: string;
}

export class OperatorReasonRequest {
  @ApiProperty({ description: 'Why: written to the audit log', minLength: REASON_MIN, maxLength: REASON_MAX })
  @IsString()
  @Length(REASON_MIN, REASON_MAX)
  @Validate(IsNotOnlyWhitespace)
  reason: string;
}

export class DeleteOrganizationRequest {
  @ApiProperty({ description: "The organization's slug, typed by its owner to confirm" })
  @IsString()
  @Length(1, 64)
  slug: string;
}

export class ProjectAdminChoice {
  @ApiProperty()
  @IsString()
  @Length(1, 64)
  projectId: string;

  @ApiProperty({ description: 'A member of the project, who becomes its admin' })
  @IsString()
  @Length(1, 64)
  userId: string;
}

export class OrganizationOwnerChoice {
  @ApiProperty()
  @IsString()
  @Length(1, 64)
  organizationId: string;

  @ApiProperty({ description: 'A member of the organization, who becomes its owner' })
  @IsString()
  @Length(1, 64)
  userId: string;
}

export class OrganizationDeletionChoice {
  @ApiProperty()
  @IsString()
  @Length(1, 64)
  organizationId: string;

  @ApiProperty({ description: "The organization's slug, typed to confirm" })
  @IsString()
  @Length(1, 64)
  slug: string;
}

export class DeleteAccountRequest {
  @ApiPropertyOptional({ type: ProjectAdminChoice, isArray: true })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => ProjectAdminChoice)
  projectAdmins?: ProjectAdminChoice[];

  @ApiPropertyOptional({ type: OrganizationOwnerChoice, isArray: true })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => OrganizationOwnerChoice)
  organizationOwners?: OrganizationOwnerChoice[];

  @ApiPropertyOptional({ type: OrganizationDeletionChoice, isArray: true })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => OrganizationDeletionChoice)
  deleteOrganizations?: OrganizationDeletionChoice[];
}

// Answers

export class OperatorPersonDTO {
  @ApiProperty()
  userId: string;
  @ApiProperty()
  name: string;
  @ApiProperty()
  email: string;
}

export class OperatorOrganizationDTO {
  @ApiProperty()
  id: string;
  @ApiProperty()
  name: string;
  @ApiProperty()
  slug: string;
  @ApiProperty({ enum: OrganizationStatus })
  status: OrganizationStatus;
  @ApiProperty({ enum: OrganizationPlanCode, description: 'The plan as stored; see the detail for the effective plan' })
  planCode: OrganizationPlanCode;
  @ApiProperty()
  isDefault: boolean;
  @ApiProperty({ type: OperatorPersonDTO, nullable: true })
  owner: OperatorPersonDTO | null;
  @ApiProperty()
  membersCount: number;
  @ApiProperty()
  projectsCount: number;
  @ApiProperty({ description: 'The cached counter' })
  seatsUsed: number;
  @ApiProperty({ description: 'The cached counter' })
  stringsUsed: number;
  @ApiProperty()
  date: AccessDatesDTO;
}

export class OperatorAuditOrganizationDTO {
  @ApiProperty()
  id: string;
  @ApiProperty()
  name: string;
  @ApiProperty()
  slug: string;
}

export class OperatorAuditActorDTO {
  @ApiProperty()
  userId: string;
  @ApiProperty({ description: 'The e-mail of the account when it acted' })
  email: string;
}

export class OperatorAuditDateDTO {
  @ApiProperty()
  created: string;
}

export class OperatorAuditDTO {
  @ApiProperty()
  id: string;
  @ApiProperty({ enum: OperatorAuditAction })
  action: OperatorAuditAction;
  @ApiProperty()
  operator: OperatorAuditActorDTO;
  @ApiProperty({ type: OperatorAuditOrganizationDTO, nullable: true })
  organization: OperatorAuditOrganizationDTO | null;
  @ApiProperty()
  reason: string;
  @ApiProperty()
  date: OperatorAuditDateDTO;
}

export class OperatorUsageDTO {
  @ApiProperty()
  seats: OrganizationSeatsDTO;
  @ApiProperty()
  strings: OrganizationStringsDTO;
}

export class OperatorOrganizationDetailDTO extends OperatorOrganizationDTO {
  @ApiProperty({ description: 'The effective plan' })
  plan: OrganizationPlanDTO;
  @ApiProperty({ description: 'Counted now' })
  usage: OperatorUsageDTO;
  @ApiProperty({ type: OperatorAuditDTO, isArray: true, description: 'The latest actions on it, newest first' })
  audit: OperatorAuditDTO[];
}

export class PageMetaDTO {
  @ApiProperty()
  total: number;
  @ApiProperty()
  page: number;
  @ApiProperty()
  limit: number;
}

export class OperatorStatusDTO {
  @ApiProperty()
  operator: boolean;
}

export class OperatorStatusResponse extends ServiceApiResponse<OperatorStatusDTO> {
  @ApiProperty()
  data: OperatorStatusDTO;
}

export class ListOperatorOrganizationsResponse extends ServiceApiResponse<OperatorOrganizationDTO[]> {
  @ApiProperty({ type: OperatorOrganizationDTO, isArray: true })
  data: OperatorOrganizationDTO[];
  @ApiProperty()
  meta: PageMetaDTO;
}

export class OperatorOrganizationResponse extends ServiceApiResponse<OperatorOrganizationDetailDTO> {
  @ApiProperty()
  data: OperatorOrganizationDetailDTO;
}

export class ListOperatorAuditResponse extends ServiceApiResponse<OperatorAuditDTO[]> {
  @ApiProperty({ type: OperatorAuditDTO, isArray: true })
  data: OperatorAuditDTO[];
  @ApiProperty()
  meta: PageMetaDTO;
}

export class AccountDeletionProjectDTO {
  @ApiProperty()
  id: string;
  @ApiProperty()
  name: string;
  @ApiProperty()
  organizationId: string;
  @ApiProperty({ type: OrganizationMemberDTO, isArray: true, description: 'The other members, one of whom becomes admin' })
  members: OrganizationMemberDTO[];
}

export class AccountDeletionOrganizationDTO {
  @ApiProperty()
  id: string;
  @ApiProperty()
  name: string;
  @ApiProperty()
  slug: string;
  @ApiProperty({ enum: OrganizationStatus })
  status: OrganizationStatus;
  @ApiProperty()
  projectsCount: number;
  @ApiProperty({ description: 'Nobody else is in it: it may be deleted with the account' })
  onlyMember: boolean;
  @ApiProperty({ type: OrganizationMemberDTO, isArray: true, description: 'The other members, one of whom becomes owner' })
  members: OrganizationMemberDTO[];
}

export class AccountDeletionPlanDTO {
  @ApiProperty({ type: AccountDeletionProjectDTO, isArray: true })
  projects: AccountDeletionProjectDTO[];
  @ApiProperty({ type: AccountDeletionOrganizationDTO, isArray: true })
  organizations: AccountDeletionOrganizationDTO[];
}

export class AccountDeletionPlanResponse extends ServiceApiResponse<AccountDeletionPlanDTO> {
  @ApiProperty()
  data: AccountDeletionPlanDTO;
}

/** A page number of a query, within `[1, max]`, `fallback` when absent. */
export function pageNumber(value: string | undefined, fallback: number, max: number): number {
  const parsed = value === undefined ? fallback : Number.parseInt(value, 10);
  return Math.min(Math.max(Number.isFinite(parsed) ? parsed : fallback, 1), max);
}
