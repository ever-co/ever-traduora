import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { Store } from '@ngxs/store';
import { Subject } from 'rxjs';
import { OrganizationsService } from '../../../organizations/services/organizations.service';
import { AuthService } from '../../services/auth.service';
import { AcceptInviteComponent } from './accept-invite.component';

describe('AcceptInviteComponent', () => {
  const planLimit = new HttpErrorResponse({
    status: 402,
    error: { error: { code: 'plan_limit_reached', message: 'Your plan allows 15 members. Upgrade to add more.', resource: 'seats', limit: 15 } },
  });
  const notFound = new HttpErrorResponse({ status: 404, error: { error: { code: 'NotFound' } } });

  const render = (kind: string | null) => {
    const answer = new Subject<never>();
    TestBed.configureTestingModule({
      declarations: [AcceptInviteComponent],
      providers: [
        provideRouter([]),
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { queryParamMap: convertToParamMap(kind ? { invite: 'token', kind } : { invite: 'token' }) } },
        },
        { provide: AuthService, useValue: { acceptInvite: () => answer } },
        { provide: OrganizationsService, useValue: { acceptInvite: () => answer } },
        { provide: Store, useValue: { dispatch: () => undefined } },
      ],
    });
    TestBed.overrideTemplate(AcceptInviteComponent, '<p class="message">{{ errorMessage }}</p>');
    const fixture = TestBed.createComponent(AcceptInviteComponent);
    fixture.detectChanges();
    return { fixture, answer };
  };

  for (const kind of ['organization', null]) {
    it(`says a full organization has no free seat, with its limit (${kind ?? 'project'} invitation)`, () => {
      const { fixture, answer } = render(kind);
      answer.error(planLimit);
      fixture.detectChanges();
      expect(fixture.componentInstance.errorMessage).toBe(
        `This organization's plan allows 15 members, and every seat is taken. Ask one of its owners or admins to free a seat or upgrade.`,
      );
    });

    it(`keeps the link message for any other failure (${kind ?? 'project'} invitation)`, () => {
      const { fixture, answer } = render(kind);
      answer.error(notFound);
      fixture.detectChanges();
      expect(fixture.componentInstance.errorMessage).toContain('This invitation link does not work for your account');
    });
  }
});
