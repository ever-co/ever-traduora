import { Component, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { Store } from '@ngxs/store';
import { LoginWithGoogle, SignupWithGoogle } from '../../stores/auth.state';

@Component({
  selector: 'app-redirect',
  templateUrl: './redirect.component.html',
  styleUrls: ['./redirect.component.css'],
})
export class RedirectComponent implements OnInit {
  constructor(private activatedRoute: ActivatedRoute, private store: Store, private router: Router) {}
  ngOnInit(): void {
    this.activatedRoute.queryParams.subscribe(params => {
      if (!params.code) {
        this.router.navigate(['/']);
      }

      switch (params.state) {
        case 'login':
          this.store.dispatch(new LoginWithGoogle(params.code));
          break;
        case 'signup':
          this.store.dispatch(new SignupWithGoogle(params.code));
          break;
        default:
          this.router.navigate(['/']);
      }
    });
  }
}
