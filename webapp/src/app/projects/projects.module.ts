import { CommonModule } from '@angular/common';
import { NgModule } from '@angular/core';
import { RouterModule } from '@angular/router';
import { NgxsModule } from '@ngxs/store';
import { CanGuard } from '../shared/guards/can.guard';
import { SharedModule } from '../shared/shared.module';
import { AddApiClientComponent } from './components/add-api-client/add-api-client.component';
import { AddTeamMemberComponent } from './components/add-team-member/add-team-member.component';
import { ApiClientComponent } from './components/api-client/api-client.component';
import { ApiClientsOverviewComponent } from './components/api-clients-overview/api-clients-overview.component';
import { ExportContainerComponent } from './components/export-container/export-container.component';
import { ExportLocaleComponent } from './components/export-locale/export-locale.component';
import { ImportContainerComponent } from './components/import-container/import-container.component';
import { ImportLocaleComponent } from './components/import-locale/import-locale.component';
import { NewProjectComponent } from './components/new-project/new-project.component';
import { NewTermComponent } from './components/new-term/new-term.component';
import { ProjectCardComponent } from './components/project-card/project-card.component';
import { ProjectContainerComponent } from './components/project-container/project-container.component';
import { ProjectListComponent } from './components/project-list/project-list.component';
import { ProjectLocalesComponent } from './components/project-locales/project-locales.component';
import { ProjectSettingsComponent } from './components/project-settings/project-settings.component';
import { TeamMemberComponent } from './components/team-member/team-member.component';
import { TeamOverviewComponent } from './components/team-overview/team-overview.component';
import { TermsListComponent } from './components/terms-list/terms-list.component';
import { TranslationsListComponent } from './components/translations-list/translations-list.component';
import { ProjectRole } from './models/project-role';
import { ProjectsState } from './stores/projects.state';
import { TermsState } from './stores/terms.state';
import { TranslationsState } from './stores/translations.state';

@NgModule({
  imports: [
    CommonModule,
    SharedModule,
    NgxsModule.forFeature([ProjectsState, TermsState, TranslationsState]),
    RouterModule.forChild([
      { path: '', component: ProjectListComponent },
      {
        path: ':projectId',
        component: ProjectContainerComponent,
        children: [
          { path: '', redirectTo: 'translations', pathMatch: 'full' },
          { path: 'terms', component: TermsListComponent },
          { path: 'translations', component: ProjectLocalesComponent },
          { path: 'translations/:localeCode', component: TranslationsListComponent },
          { path: 'team', component: TeamOverviewComponent },
          { path: 'api', component: ApiClientsOverviewComponent },
          {
            path: 'import',
            component: ImportContainerComponent,
            canActivate: [CanGuard],
            data: { roles: [ProjectRole.Admin, ProjectRole.Editor] },
          },
          { path: 'export', component: ExportContainerComponent },
          { path: 'settings', component: ProjectSettingsComponent },
        ],
      },
    ]),
  ],
  declarations: [
    ProjectListComponent,
    NewProjectComponent,
    ProjectSettingsComponent,
    ProjectContainerComponent,
    ImportLocaleComponent,
    TermsListComponent,
    ProjectCardComponent,
    TranslationsListComponent,
    NewTermComponent,
    ExportLocaleComponent,
    ImportContainerComponent,
    ExportContainerComponent,
    ProjectLocalesComponent,
    TeamOverviewComponent,
    AddTeamMemberComponent,
    TeamMemberComponent,
    ApiClientsOverviewComponent,
    AddApiClientComponent,
    ApiClientComponent,
  ],
})
export class ProjectsModule {}
