import { Component, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { Store } from '@ngxs/store';
import { ReceiveAuthProviderCode } from '../../stores/auth.state';

@Component({
  selector: 'app-callback',
  templateUrl: './callback.component.html',
  styleUrls: ['./callback.component.css'],
})
export class AuthCallbackComponent implements OnInit {
  constructor(
    private activatedRoute: ActivatedRoute,
    private store: Store,
    private router: Router,
  ) {}
  ngOnInit(): void {
    this.activatedRoute.queryParams.subscribe(params => {
      if (!params.code) {
        this.router.navigate(['/']);
      }
      this.store.dispatch(new ReceiveAuthProviderCode(params.code));
    });
  }
}
