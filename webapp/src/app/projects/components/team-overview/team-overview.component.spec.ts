import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { NO_ERRORS_SCHEMA, Pipe, PipeTransform } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NgxsModule, Store } from '@ngxs/store';
import { of } from 'rxjs';
import { environment } from '../../../../environments/environment';
import { ErrorMessageComponent } from '../../../shared/components/error-message/error-message.component';
import { ProjectRole } from '../../models/project-role';
import { ProjectInviteState } from '../../stores/project-invite.state';
import { ProjectUserState } from '../../stores/project-user.state';
import { TeamOverviewComponent } from './team-overview.component';

@Pipe({ name: 'can' })
class AllowAllPipe implements PipeTransform {
  transform() {
    return of(true);
  }
}

describe('TeamOverviewComponent error message', () => {
  const projectUrl = `${environment.apiEndpoint}/projects/p1`;
  const badRequest = { error: { code: 'BadRequest', message: 'Bad request' } };

  let fixture: ComponentFixture<TeamOverviewComponent>;
  let store: Store;
  let http: HttpTestingController;

  const errorMessage = (): string | undefined => fixture.nativeElement.querySelector('app-error-message p')?.textContent.trim();

  const setErrors = (users: string | undefined, invites: string | undefined) => {
    const state = store.snapshot();
    store.reset({
      ...state,
      projectUsers: { ...state.projectUsers, errorMessage: users },
      projectInvites: { ...state.projectInvites, errorMessage: invites },
    });
    fixture.detectChanges();
  };

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [NgxsModule.forRoot([ProjectUserState, ProjectInviteState]), AllowAllPipe],
      declarations: [TeamOverviewComponent, ErrorMessageComponent],
      schemas: [NO_ERRORS_SCHEMA],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    store = TestBed.inject(Store);
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(TeamOverviewComponent);
    Object.defineProperty(fixture.componentInstance, 'project$', { value: of({ id: 'p1' }), configurable: true });
    fixture.detectChanges();
    http.expectOne(`${projectUrl}/users`).flush({ data: [] });
    http.expectOne(`${projectUrl}/invites`).flush({ data: [{ id: 'i1', email: 'new@example.test', role: ProjectRole.Editor }] });
    fixture.detectChanges();
  });

  afterEach(() => fixture.destroy());

  it('shows the error of an invite role change the API refused', () => {
    expect(errorMessage()).toBeUndefined();

    fixture.componentInstance.updateProjectInvite('p1', 'i1', ProjectRole.Admin);
    http.expectOne(`${projectUrl}/invites/i1`).flush(badRequest, { status: 400, statusText: 'Bad Request' });
    fixture.detectChanges();

    expect(errorMessage()).toBe('Bad request, please check your values and try again.');
  });

  it('shows the error of an invite revoke the API refused', () => {
    spyOn(window, 'confirm').and.returnValue(true);

    fixture.componentInstance.removeProjectInvite('p1', 'i1');
    http.expectOne(`${projectUrl}/invites/i1`).flush(null, { status: 404, statusText: 'Not Found' });
    fixture.detectChanges();

    expect(errorMessage()).toBe('Error, resource not found');
  });

  it('still shows an error of the team members', () => {
    setErrors('Members error', undefined);

    expect(errorMessage()).toBe('Members error');
  });

  it('clears the members and invites errors when the page is left', () => {
    setErrors('Members error', 'Invites error');

    fixture.destroy();

    expect(store.snapshot().projectUsers.errorMessage).toBeUndefined();
    expect(store.snapshot().projectInvites.errorMessage).toBeUndefined();
  });
});
