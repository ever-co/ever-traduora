import { Component } from '@angular/core';
import { Select, Store } from '@ngxs/store';
import { Observable } from 'rxjs';
import { User } from '../../../auth/models/user';
import { AuthState, Logout } from '../../../auth/stores/auth.state';

@Component({
  selector: 'app-bar',
  templateUrl: './app-bar.component.html',
  styleUrls: ['./app-bar.component.css'],
})
export class AppBarComponent {
  @Select(AuthState.user)
  user$: Observable<User>;

  constructor(private store: Store) {}

  logout() {
    this.store.dispatch(new Logout());
  }
}
