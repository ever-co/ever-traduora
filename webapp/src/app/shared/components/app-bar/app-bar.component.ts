import { Component } from '@angular/core';
import { Select, Store } from '@ngxs/store';
import { Observable } from 'rxjs';
import { User } from '../../../auth/models/user';
import { AuthState, Logout } from '../../../auth/stores/auth.state';
import { EverStatsService } from '../../../ever-platform/services/ever-stats.service';

@Component({
  standalone: false,
  selector: 'app-bar',
  templateUrl: './app-bar.component.html',
  styleUrls: ['./app-bar.component.css'],
})
export class AppBarComponent {
  @Select(AuthState.user)
  user$: Observable<User>;

  /** The Ever Platform page is listed only for the operator of the installation, when the statistics module is loaded. */
  everPlatform$: Observable<boolean>;

  constructor(
    private store: Store,
    everStats: EverStatsService,
  ) {
    this.everPlatform$ = everStats.isAvailable();
  }

  logout() {
    this.store.dispatch(new Logout());
  }
}
