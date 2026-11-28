import { HttpEventType, provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { NgxsModule, Store } from '@ngxs/store';
import { environment } from '../../../../environments/environment';
import { Organization, OrganizationMember } from '../../models/organization';
import { OrganizationsState } from '../../stores/organizations.state';
import { exportFileName, OrganizationSettingsComponent, sizeFigure } from './organization-settings.component';

describe('OrganizationSettingsComponent danger zone', () => {
  const endpoint = environment.apiEndpoint;
  const acme: Organization = {
    id: 'o1',
    name: 'Acme Translations',
    slug: 'acme',
    status: 'active',
    planCode: 'starter',
    isDefault: false,
    adminsSeeAllProjects: true,
    role: 'owner',
  };
  const other: Organization = { ...acme, id: 'o2', name: 'Globex', slug: 'globex', role: 'member' };
  const owner: OrganizationMember = { userId: 'u1', name: 'Ada', email: 'ada@example.test', role: 'owner' };

  let store: Store;
  let http: HttpTestingController;
  let router: Router;

  const render = (organization: Organization): ComponentFixture<OrganizationSettingsComponent> => {
    store.reset({
      ...store.snapshot(),
      organizations: {
        ...store.snapshot().organizations,
        organizations: [organization, other],
        loaded: true,
        currentOrganizationId: organization.id,
      },
    });
    const fixture = TestBed.createComponent(OrganizationSettingsComponent);
    fixture.detectChanges();
    if (organization.role === 'owner' && !organization.isDefault) {
      http.expectOne(`${endpoint}/organizations/${organization.id}/members`).flush({ data: [owner] });
    }
    fixture.detectChanges();
    return fixture;
  };

  const q = (fixture: ComponentFixture<unknown>, test: string) => fixture.nativeElement.querySelector(`[data-test="${test}"]`) as HTMLElement | null;

  /** The element, or a failure naming what is missing. */
  const el = (fixture: ComponentFixture<unknown>, test: string): HTMLElement => {
    const found = q(fixture, test);
    if (!found) {
      throw new Error(`No [data-test="${test}"]`);
    }
    return found;
  };

  const typeSlug = (fixture: ComponentFixture<unknown>, value: string) => {
    const input = q(fixture, 'delete-slug') as HTMLInputElement;
    input.value = value;
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
  };

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [OrganizationSettingsComponent, NgxsModule.forRoot([OrganizationsState])],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    });
    store = TestBed.inject(Store);
    http = TestBed.inject(HttpTestingController);
    router = TestBed.inject(Router);
  });

  afterEach(() => http.verify());

  it('offers the export to the owner and the admins, the deletion to the owner only', () => {
    const asOwner = render(acme);
    expect(q(asOwner, 'export')).not.toBeNull();
    expect(q(asOwner, 'delete')).not.toBeNull();
    asOwner.destroy();

    const asAdmin = render({ ...acme, role: 'admin' });
    expect(q(asAdmin, 'export')).not.toBeNull();
    expect(q(asAdmin, 'delete')).toBeNull();
    asAdmin.destroy();

    const asMember = render({ ...acme, role: 'member' });
    expect(q(asMember, 'export')).toBeNull();
    expect(q(asMember, 'delete')).toBeNull();
  });

  it('never offers to export or delete the default organization', () => {
    const fixture = render({ ...acme, isDefault: true });
    expect(q(fixture, 'export')).toBeNull();
    expect(q(fixture, 'delete')).toBeNull();
  });

  it('downloads the export as <slug>-export-<day>.zip, showing what arrived', () => {
    const fixture = render({ ...acme, role: 'admin' });
    const save = spyOn(fixture.componentInstance, 'saveFile');
    el(fixture, 'export-button').click();
    fixture.detectChanges();
    expect(el(fixture, 'export-button').textContent?.trim()).toBe('Preparing the export');
    expect((q(fixture, 'export-button') as HTMLButtonElement).disabled).toBe(true);

    const req = http.expectOne(`${endpoint}/organizations/o1/export`);
    expect(req.request.responseType).toBe('blob');
    req.event({ type: HttpEventType.DownloadProgress, loaded: 3 * 1024 * 1024 });
    fixture.detectChanges();
    expect(el(fixture, 'export-progress').textContent?.trim()).toBe('3.0 MB received');

    const zip = new Blob(['PK'], { type: 'application/zip' });
    req.flush(zip);
    fixture.detectChanges();
    expect(save).toHaveBeenCalledWith(zip, exportFileName('acme'));
    expect(exportFileName('acme')).toMatch(/^acme-export-\d{4}-\d{2}-\d{2}\.zip$/);
    expect(el(fixture, 'export-button').textContent?.trim()).toBe('Download export');
  });

  it("reads the error of a failed export from the download's body", async () => {
    const fixture = render(acme);
    el(fixture, 'export-button').click();
    const body = new Blob([JSON.stringify({ error: { code: 'organization_suspended', message: 'Suspended' } })], { type: 'application/json' });
    http.expectOne(`${endpoint}/organizations/o1/export`).flush(body, { status: 403, statusText: 'Forbidden' });
    // The body is read from the blob, which takes the browser a few turns
    for (let turn = 0; turn < 50 && !fixture.componentInstance.exportError; turn++) {
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    fixture.detectChanges();
    expect(el(fixture, 'export-error').textContent).toContain('This organization is suspended');
    expect(el(fixture, 'export-button').textContent?.trim()).toBe('Download export');
  });

  it('deletes only once the owner typed the address, then opens another organization', () => {
    const navigate = spyOn(router, 'navigate').and.resolveTo(true);
    const fixture = render(acme);
    const button = q(fixture, 'delete-button') as HTMLButtonElement;
    expect(el(fixture, 'delete').textContent).toContain('every project goes');
    expect(el(fixture, 'delete').textContent).toContain('the subscription is cancelled');
    expect(button.disabled).toBe(true);

    typeSlug(fixture, 'acm');
    expect(button.disabled).toBe(true);
    button.click();
    http.expectNone(`${endpoint}/organizations/o1`);

    typeSlug(fixture, ' acme ');
    expect(button.disabled).toBe(false);
    button.click();
    const req = http.expectOne(request => request.method === 'DELETE' && request.url === `${endpoint}/organizations/o1`);
    expect(req.request.body).toEqual({ slug: 'acme' });
    req.flush(null, { status: 204, statusText: 'No Content' });

    // The list is read again, without the deleted organization
    http.expectOne(`${endpoint}/organizations`).flush({ data: [other] });
    expect(navigate).toHaveBeenCalledWith(['/orgs', 'globex', 'projects'], { replaceUrl: true });
  });

  it('sends the owner of their last organization to create one', () => {
    const navigate = spyOn(router, 'navigate').and.resolveTo(true);
    const fixture = render(acme);
    typeSlug(fixture, 'acme');
    el(fixture, 'delete-button').click();
    http.expectOne(request => request.method === 'DELETE').flush(null, { status: 204, statusText: 'No Content' });
    http.expectOne(`${endpoint}/organizations`).flush({ data: [] });
    expect(navigate).toHaveBeenCalledWith(['/orgs', 'new'], { replaceUrl: true });
  });

  it('says why a deletion was refused', () => {
    const navigate = spyOn(router, 'navigate').and.resolveTo(true);
    const fixture = render(acme);
    typeSlug(fixture, 'acme');
    el(fixture, 'delete-button').click();
    http
      .expectOne(request => request.method === 'DELETE')
      .flush({ error: { code: 'slug_mismatch', message: 'Mismatch' } }, { status: 400, statusText: 'Bad Request' });
    fixture.detectChanges();
    expect(el(fixture, 'delete-error').textContent).toContain('does not match');
    expect(navigate).not.toHaveBeenCalled();
  });

  it('writes sizes in KB under a megabyte and in MB above', () => {
    expect(sizeFigure(200)).toBe('1 KB');
    expect(sizeFigure(640 * 1024)).toBe('640 KB');
    expect(sizeFigure(1.25 * 1024 * 1024)).toBe('1.3 MB');
  });
});
