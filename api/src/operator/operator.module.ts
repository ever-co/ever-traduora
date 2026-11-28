import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { OPERATOR_CHECK } from '../access/operator-check';
import { Label } from '../entity/label.entity';
import { OperatorAudit } from '../entity/operator-audit.entity';
import { OrganizationUser } from '../entity/organization-user.entity';
import { Organization } from '../entity/organization.entity';
import { ProjectClient } from '../entity/project-client.entity';
import { ProjectLocale } from '../entity/project-locale.entity';
import { ProjectUser } from '../entity/project-user.entity';
import { Project } from '../entity/project.entity';
import { Term } from '../entity/term.entity';
import AuthorizationService from '../services/authorization.service';
import { OrganizationDeletion } from '../services/organization/organization-deletion.service';
import { OrganizationExport } from '../services/organization/organization-export.service';
import { OperatorOrganizations } from '../services/organization/organization-operator.service';
import { OperatorCheckService } from './operator-check.service';
import { OperatorController } from './operator.controller';
import { OrganizationDataController } from './organization-data.controller';

/**
 * P6, the operator console and the data rights (DESIGN §3.9): the operators' organization list, detail, suspension and
 * audit log (`/api/v1/operator/...`), and an organization's export and deletion (`/api/v1/organizations/:id/export`,
 * `DELETE /api/v1/organizations/:id`). Always imported; every route answers 404 on a single-tenant install. Account
 * deletion with its hand-overs stays with the user routes (`UserController`, `UserService.deleteAccount`).
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([OperatorAudit, Organization, OrganizationUser, Project, ProjectUser, ProjectClient, ProjectLocale, Term, Label]),
  ],
  controllers: [OperatorController, OrganizationDataController],
  providers: [
    AuthorizationService,
    OperatorOrganizations,
    OrganizationExport,
    OrganizationDeletion,
    OperatorCheckService,
    // The check of the access guard's `operator` rule, also without the Ever Platform modules
    { provide: OPERATOR_CHECK, useExisting: OperatorCheckService },
  ],
})
export class OperatorModule {}
