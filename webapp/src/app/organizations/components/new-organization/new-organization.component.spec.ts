import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { NgxsModule } from '@ngxs/store';
import { environment } from '../../../../environments/environment';
import { OrganizationsState } from '../../stores/organizations.state';
import { NewOrganizationComponent } from './new-organization.component';

describe('NewOrganizationComponent', () => {
  const endpoint = environment.apiEndpoint;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [NewOrganizationComponent, NgxsModule.forRoot([OrganizationsState])],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    });
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('derives the address from the name until it is edited, then creates the organization and opens it', () => {
    const fixture = TestBed.createComponent(NewOrganizationComponent);
    fixture.detectChanges();
    http.expectOne(`${endpoint}/organizations`).flush({ data: [] });
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('You are not in an organization yet');

    const form = fixture.componentInstance.form;
    form.controls.name.setValue('Acme Translations');
    expect(form.controls.slug.value).toBe('acme-translations');
    fixture.componentInstance.slugInput();
    form.controls.slug.setValue('acme');
    form.controls.name.setValue('Acme Translations Ltd');
    expect(form.controls.slug.value).toBe('acme');

    const navigate = spyOn(TestBed.inject(Router), 'navigate').and.resolveTo(true);
    fixture.componentInstance.create();
    const post = http.expectOne(`${endpoint}/organizations`);
    expect(post.request.body).toEqual({ name: 'Acme Translations Ltd', slug: 'acme' });
    post.flush({ data: { id: 'o1', name: 'Acme Translations Ltd', slug: 'acme', role: 'owner' } });
    expect(navigate).toHaveBeenCalledWith(['/orgs', 'acme', 'projects']);
  });

  it('refuses a reserved address before asking the API', () => {
    const fixture = TestBed.createComponent(NewOrganizationComponent);
    fixture.detectChanges();
    http.expectOne(`${endpoint}/organizations`).flush({ data: [] });
    fixture.componentInstance.form.setValue({ name: 'Admin', slug: 'admin' });
    expect(fixture.componentInstance.form.valid).toBe(false);
    fixture.componentInstance.create();
    http.expectNone(`${endpoint}/organizations`);
  });
});
