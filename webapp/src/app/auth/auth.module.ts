import { CommonModule } from '@angular/common';
import { NgModule } from '@angular/core';
import { RouterModule } from '@angular/router';
import { NgxsModule } from '@ngxs/store';
import { SharedModule } from '../shared/shared.module';
import { ForgotPasswordComponent } from './components/forgot-password/forgot-password.component';
import { LoginComponent } from './components/login/login.component';
import { RedirectComponent } from './components/redirect/redirect.component';
import { ResetPasswordComponent } from './components/reset-password/reset-password.component';
import { SignupComponent } from './components/signup/signup.component';
import { UserSettingsComponent } from './components/user-settings/user-settings.component';
import { AuthGuard } from './guards/auth.guard';
import { NoAuthGuard } from './guards/no-auth.guard';
import { AuthState } from './stores/auth.state';

@NgModule({
  declarations: [LoginComponent, SignupComponent, ForgotPasswordComponent, UserSettingsComponent, ResetPasswordComponent, RedirectComponent],
  imports: [
    CommonModule,
    SharedModule,
    NgxsModule.forFeature([AuthState]),
    RouterModule.forChild([
      {
        path: 'signup',
        component: SignupComponent,
        canActivate: [NoAuthGuard],
      },
      {
        path: 'redirect',
        component: RedirectComponent,
        canActivate: [NoAuthGuard],
      },
      {
        path: 'login',
        component: LoginComponent,
        canActivate: [NoAuthGuard],
      },
      {
        path: 'forgot-password',
        component: ForgotPasswordComponent,
        canActivate: [NoAuthGuard],
      },
      {
        path: 'reset-password',
        component: ResetPasswordComponent,
        canActivate: [NoAuthGuard],
      },
      {
        path: 'user-settings',
        component: UserSettingsComponent,
        canActivate: [AuthGuard],
      },
    ]),
  ],
  exports: [RouterModule],
})
export class AuthModule {}
