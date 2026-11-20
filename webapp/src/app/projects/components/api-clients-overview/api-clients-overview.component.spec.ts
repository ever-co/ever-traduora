import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { NO_ERRORS_SCHEMA, Pipe, PipeTransform } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NgxsModule, Store } from '@ngxs/store';
import { of } from 'rxjs';
import { environment } from '../../../../environments/environment';
import { ErrorMessageComponent } from '../../../shared/components/error-message/error-message.component';
import { ProjectRole } from '../../models/project-role';
import { ProjectClientState } from '../../stores/project-client.state';
import { ProjectUserState } from '../../stores/project-user.state';
import { ApiClientsOverviewComponent } from './api-clients-overview.component';

@Pipe({ name: 'can' })
class AllowAllPipe implements PipeTransform {
  transform() {
    return of(true);
  }
}

describe('ApiClientsOverviewComponent error message', () => {
  const clientsUrl = `${environment.apiEndpoint}/projects/p1/clients`;
  const badRequest = { error: { code: 'BadRequest', message: 'Bad request' } };

  let fixture: ComponentFixture<ApiClientsOverviewComponent>;
  let store: Store;
  let http: HttpTestingController;

  const errorMessage = (): string | undefined => fixture.nativeElement.querySelector('app-error-message p')?.textContent.trim();

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [NgxsModule.forRoot([ProjectClientState, ProjectUserState]), AllowAllPipe],
      declarations: [ApiClientsOverviewComponent, ErrorMessageComponent],
      schemas: [NO_ERRORS_SCHEMA],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    store = TestBed.inject(Store);
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(ApiClientsOverviewComponent);
    Object.defineProperty(fixture.componentInstance, 'project$', { value: of({ id: 'p1' }), configurable: true });
    fixture.detectChanges();
    http.expectOne(clientsUrl).flush({ data: [{ id: 'c1', name: 'CI', role: ProjectRole.Editor }] });
    fixture.detectChanges();
  });

  afterEach(() => fixture.destroy());

  it('shows the error of a role change the API refused', () => {
    expect(errorMessage()).toBeUndefined();

    fixture.componentInstance.updateProjectClient('p1', 'c1', ProjectRole.Admin);
    http.expectOne(`${clientsUrl}/c1`).flush(badRequest, { status: 400, statusText: 'Bad Request' });
    fixture.detectChanges();

    expect(errorMessage()).toBe('Bad request, please check your values and try again.');
  });

  it('shows the error of a revoke the API refused', () => {
    spyOn(window, 'confirm').and.returnValue(true);

    fixture.componentInstance.removeProjectClient('p1', 'c1');
    http.expectOne(`${clientsUrl}/c1`).flush(null, { status: 404, statusText: 'Not Found' });
    fixture.detectChanges();

    expect(errorMessage()).toBe('Error, resource not found');
  });

  it('does not show an error of the team page', () => {
    store.reset({ ...store.snapshot(), projectUsers: { ...store.snapshot().projectUsers, errorMessage: 'Team error' } });
    fixture.detectChanges();

    expect(errorMessage()).toBeUndefined();
  });
});
