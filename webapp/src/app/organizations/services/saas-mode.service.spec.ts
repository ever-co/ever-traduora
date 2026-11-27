import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { environment } from '../../../environments/environment';
import { SaasModeService } from './saas-mode.service';

describe('SaasModeService', () => {
  const url = `${environment.apiEndpoint}/auth/providers`;
  let http: HttpTestingController;
  let service: SaasModeService;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    http = TestBed.inject(HttpTestingController);
    service = TestBed.inject(SaasModeService);
  });

  afterEach(() => http.verify());

  it('asks again after a failed request, instead of keeping single-tenant mode', () => {
    const seen: boolean[] = [];
    service.saas$.subscribe(saas => seen.push(saas));
    http.expectOne(url).flush('down', { status: 503, statusText: 'Unavailable' });
    service.saas$.subscribe(saas => seen.push(saas));
    http.expectOne(url).flush({ data: [], saas: true });
    expect(seen).toEqual([false, true]);
  });

  it('keeps an answer, single-tenant included, for the page', () => {
    const seen: boolean[] = [];
    service.saas$.subscribe(saas => seen.push(saas));
    http.expectOne(url).flush({ data: [], saas: false });
    service.saas$.subscribe(saas => seen.push(saas));
    http.expectNone(url);
    expect(seen).toEqual([false, false]);
  });
});
