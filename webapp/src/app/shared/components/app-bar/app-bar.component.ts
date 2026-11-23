import { Component } from '@angular/core';
import { Select, Store } from '@ngxs/store';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { User } from '../../../auth/models/user';
import { AuthState, Logout } from '../../../auth/stores/auth.state';
import { EverPlatformService } from '../../../ever-platform/services/ever-platform.service';

@Component({
  standalone: false,
  selector: 'app-bar',
  templateUrl: './app-bar.component.html',
  styleUrls: ['./app-bar.component.css'],
})
export class AppBarComponent {
  @Select(AuthState.user)
  user$: Observable<User>;

  /** The Ever Platform page is listed only for the operator of the installation, when an Ever Platform module is loaded. */
  everPlatform$: Observable<boolean>;

  constructor(
    private store: Store,
    everPlatform: EverPlatformService,
  ) {
    this.everPlatform$ = everPlatform.pages().pipe(map(pages => !!pages));
  }

  logout() {
    this.store.dispatch(new Logout());
  }
}
