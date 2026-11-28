import { HttpClientModule, HTTP_INTERCEPTORS } from '@angular/common/http';
import { NgModule } from '@angular/core';
import { BrowserModule } from '@angular/platform-browser';
import { BrowserAnimationsModule } from '@angular/platform-browser/animations';
import { RouterModule } from '@angular/router';
import { NgbModule } from '@ng-bootstrap/ng-bootstrap';
import { NgxsReduxDevtoolsPluginModule } from '@ngxs/devtools-plugin';
import { NgxsRouterPluginModule } from '@ngxs/router-plugin';
import { NgxsModule } from '@ngxs/store';
import { environment } from '../environments/environment';
import { AppComponent } from './app.component';
import { AuthModule } from './auth/auth.module';
import { AuthGuard } from './auth/guards/auth.guard';
import { ErrorInterceptor } from './auth/services/error.interceptor';
import { TokenInterceptor } from './auth/services/token.interceptor';
import { AuthState } from './auth/stores/auth.state';
import { ProjectClientState } from './projects/stores/project-client.state';
import { ProjectUserState } from './projects/stores/project-user.state';
import { ProjectsState } from './projects/stores/projects.state';
import { TermsState } from './projects/stores/terms.state';
import { TranslationsState } from './projects/stores/translations.state';
import { NotFoundComponent } from './shared/components/not-found/not-found.component';
import { SharedModule } from './shared/shared.module';
import { ProjectInviteState } from './projects/stores/project-invite.state';
import { OrganizationsState } from './organizations/stores/organizations.state';
import { saasGuard } from './organizations/guards/organization.guards';
import { operatorGuard } from './operator/guards/operator.guard';

@NgModule({
  declarations: [AppComponent],
  imports: [
    BrowserModule,
    BrowserAnimationsModule,
    SharedModule,
    NgbModule,
    HttpClientModule,
    NgxsModule.forRoot(
      [AuthState, TermsState, ProjectsState, TranslationsState, ProjectUserState, ProjectInviteState, ProjectClientState, OrganizationsState],
      {
        developmentMode: !environment.production,
      },
    ),
    NgxsRouterPluginModule.forRoot(),
    NgxsReduxDevtoolsPluginModule.forRoot({ disabled: environment.production }),
    AuthModule,
    RouterModule.forRoot(
      [
        {
          path: '',
          pathMatch: 'full',
          redirectTo: 'projects',
        },
        {
          path: 'projects',
          loadChildren: () => import('./projects/projects.module').then(m => m.ProjectsModule),
          canActivate: [AuthGuard],
        },
        {
          // Organization pages, SaaS mode only: /orgs/new, /orgs/:slug/{projects,members,settings}
          path: 'orgs',
          loadChildren: () => import('./organizations/organizations.routes').then(m => m.ORGANIZATION_ROUTES),
          canActivate: [AuthGuard, saasGuard],
        },
        {
          // The operator console, SaaS mode only, for the installation's operators (anyone else gets the 404 page)
          path: 'operator',
          loadChildren: () => import('./operator/operator.routes').then(m => m.OPERATOR_ROUTES),
          canActivate: [AuthGuard, saasGuard, operatorGuard],
        },
        {
          // Ever Platform pages, for the operator of the installation (the API answers nobody else)
          path: 'ever-platform',
          loadChildren: () => import('./ever-platform/ever-platform.module').then(m => m.EverPlatformModule),
          canActivate: [AuthGuard],
        },
        {
          // The hand-off from app.ever.co to create an organization's project: the page asks to sign in with Ever ID itself
          path: 'ever-connect/provision',
          loadChildren: () => import('./ever-connect-provision/ever-connect-provision.module').then(m => m.EverConnectProvisionModule),
        },
        {
          path: '',
          loadChildren: () => import('./auth/auth.module').then(m => m.AuthModule),
        },
        {
          path: '404',
          component: NotFoundComponent,
        },
        {
          path: '**',
          redirectTo: '404',
        },
      ],
      { scrollPositionRestoration: 'enabled' },
    ),
  ],
  providers: [
    {
      provide: HTTP_INTERCEPTORS,
      useClass: ErrorInterceptor,
      multi: true,
    },
    {
      provide: HTTP_INTERCEPTORS,
      useClass: TokenInterceptor,
      multi: true,
    },
  ],
  bootstrap: [AppComponent],
})
export class AppModule {}
