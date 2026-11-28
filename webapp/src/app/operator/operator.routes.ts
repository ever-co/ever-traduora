import { Routes } from '@angular/router';
import { OperatorAuditComponent } from './components/operator-audit/operator-audit.component';
import { OperatorOrganizationComponent } from './components/operator-organization/operator-organization.component';
import { OperatorOrganizationsComponent } from './components/operator-organizations/operator-organizations.component';
import { OperatorShellComponent } from './components/operator-shell/operator-shell.component';

/** /operator/... (SaaS mode, operators only: see operatorGuard). */
export const OPERATOR_ROUTES: Routes = [
  {
    path: '',
    component: OperatorShellComponent,
    children: [
      { path: '', redirectTo: 'organizations', pathMatch: 'full' },
      { path: 'organizations', component: OperatorOrganizationsComponent },
      { path: 'organizations/:id', component: OperatorOrganizationComponent },
      { path: 'audit', component: OperatorAuditComponent },
    ],
  },
];
