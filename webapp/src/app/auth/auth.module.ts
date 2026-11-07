import { CommonModule } from '@angular/common';
import { NgModule } from '@angular/core';
import { RouterModule } from '@angular/router';
import { NgxsModule } from '@ngxs/store';
import { SharedModule } from '../shared/shared.module';
import { AcceptInviteComponent } from './components/accept-invite/accept-invite.component';
import { ForgotPasswordComponent } from './components/forgot-password/forgot-password.component';
import { LoginComponent } from './components/login/login.component';
import { AuthCallbackComponent } from './components/callback/callback.component';
import { ResetPasswordComponent } from './components/reset-password/reset-password.component';
import { SignupComponent } from './components/signup/signup.component';
import { UserSettingsComponent } from './components/user-settings/user-settings.component';
import { VerifyEmailComponent } from './components/verify-email/verify-email.component';
import { AuthGuard } from './guards/auth.guard';
import { NoAuthGuard } from './guards/no-auth.guard';
import { AuthState } from './stores/auth.state';
import { SignInWithComponent } from './components/sign-in-with/sign-in-with.component';
import { EverIdConfirmComponent } from './components/everid-confirm/everid-confirm.component';
import { ProviderCallbackGuard } from './guards/provider-callback.guard';

@NgModule({
  declarations: [
    AcceptInviteComponent,
    LoginComponent,
    SignupComponent,
    ForgotPasswordComponent,
    UserSettingsComponent,
    ResetPasswordComponent,
    AuthCallbackComponent,
    SignInWithComponent,
    VerifyEmailComponent,
    EverIdConfirmComponent,
  ],
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
        path: 'auth/callback',
        component: AuthCallbackComponent,
        // NoAuthGuard, except for the callback of connecting Ever ID from the account settings
        canActivate: [ProviderCallbackGuard],
      },
      {
        path: 'auth/everid/confirm',
        component: EverIdConfirmComponent,
        canActivate: [NoAuthGuard],
      },
      {
        path: 'accept-invite',
        component: AcceptInviteComponent,
        canActivate: [AuthGuard],
      },
      {
        // Signed-out users sign in first and come back to the link
        path: 'verify-email',
        component: VerifyEmailComponent,
        canActivate: [AuthGuard],
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
