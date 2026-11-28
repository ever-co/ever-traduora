import { Routes } from '@angular/router';
import { OrganizationBillingComponent } from './billing/organization-billing.component';
import { NewOrganizationComponent } from './components/new-organization/new-organization.component';
import { OrganizationMembersComponent } from './components/organization-members/organization-members.component';
import { OrganizationProjectsComponent } from './components/organization-projects/organization-projects.component';
import { OrganizationSettingsComponent } from './components/organization-settings/organization-settings.component';
import { OrganizationShellComponent } from './components/organization-shell/organization-shell.component';

/** /orgs/... (SaaS mode only, see saasGuard). Project pages keep /projects/:projectId/..., so old links keep working. */
export const ORGANIZATION_ROUTES: Routes = [
  { path: 'new', component: NewOrganizationComponent },
  {
    path: ':slug',
    component: OrganizationShellComponent,
    children: [
      { path: '', redirectTo: 'projects', pathMatch: 'full' },
      { path: 'projects', component: OrganizationProjectsComponent },
      { path: 'members', component: OrganizationMembersComponent },
      { path: 'settings', component: OrganizationSettingsComponent },
      { path: 'billing', component: OrganizationBillingComponent },
    ],
  },
];
