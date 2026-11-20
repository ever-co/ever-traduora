import { Component } from '@angular/core';
import { Select, Store } from '@ngxs/store';
import { Observable } from 'rxjs';
import { ProviderSignupConfirmation } from '../../models/identity';
import { AuthState, CancelProviderSignup, ConfirmProviderSignup } from '../../stores/auth.state';

/**
 * The confirmation screen of a new account created with Ever ID: nothing is created before the person confirms. Each
 * pending invitation for their email has its own checkbox, unchecked; only the ticked ones are accepted.
 */
@Component({
  standalone: false,
  selector: 'app-everid-confirm',
  templateUrl: './everid-confirm.component.html',
})
export class EverIdConfirmComponent {
  @Select(AuthState.pendingSignup)
  pendingSignup$: Observable<ProviderSignupConfirmation | undefined>;

  @Select(state => state.auth.isLoading)
  isLoading$: Observable<boolean>;

  readonly acceptedInvites = new Set<string>();

  constructor(private store: Store) {}

  toggleInvite(id: string, checked: boolean) {
    if (checked) {
      this.acceptedInvites.add(id);
    } else {
      this.acceptedInvites.delete(id);
    }
  }

  confirm() {
    this.store.dispatch(new ConfirmProviderSignup(Array.from(this.acceptedInvites)));
  }

  cancel() {
    this.store.dispatch(new CancelProviderSignup());
  }
}
