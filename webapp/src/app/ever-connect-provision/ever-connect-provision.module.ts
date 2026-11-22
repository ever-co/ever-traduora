import { CommonModule } from '@angular/common';
import { NgModule } from '@angular/core';
import { RouterModule } from '@angular/router';
import { SharedModule } from '../shared/shared.module';
import { ProvisionComponent } from './components/provision/provision.component';

/**
 * The landing page app.ever.co sends a person to, to create their organization's project here (hand-off provisioning).
 * Not behind the sign-in guard: the page asks to sign in with Ever ID itself (loaded on demand).
 */
@NgModule({
  declarations: [ProvisionComponent],
  imports: [CommonModule, SharedModule, RouterModule.forChild([{ path: '', component: ProvisionComponent }])],
})
export class EverConnectProvisionModule {}
