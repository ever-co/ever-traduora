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

  it('asks again after a failed request, instead of keeping single-tenant mode, and tells every subscriber', () => {
    const seen: boolean[] = [];
    service.saas$.subscribe(saas => seen.push(saas));
    http.expectOne(url).flush('down', { status: 503, statusText: 'Unavailable' });
    service.saas$.subscribe(saas => seen.push(saas));
    http.expectOne(url).flush({ data: [], saas: true });
    expect(seen).toEqual([false, true, true]);
  });

  it('keeps a failure apart from a single-tenant answer, and reload() updates an open form', () => {
    const states: string[] = [];
    service.state$.subscribe(state => states.push(state.status === 'loaded' ? `loaded saas=${state.settings.saas}` : state.status));
    http.expectOne(url).flush('down', { status: 503, statusText: 'Unavailable' });
    expect(states).toEqual(['loading', 'failed']);
    service.reload();
    http.expectOne(url).flush({ data: [], saas: false });
    expect(states).toEqual(['loading', 'failed', 'loading', 'loaded saas=false']);
  });

  it('reads the Turnstile site key and the legal documents from the same answer', () => {
    const legal = { terms: { version: '1.1.0', url: 'https://traduora.co/tos' }, privacy: { version: '1.0.2', url: 'https://traduora.co/privacy' } };
    const seen: unknown[] = [];
    service.settings$.subscribe(settings => seen.push(settings));
    http.expectOne(url).flush({ data: [], saas: true, turnstileSiteKey: 'site-key', legal });
    service.settings$.subscribe(settings => seen.push(settings));
    expect(seen).toEqual([
      { saas: true, turnstileSiteKey: 'site-key', legal },
      { saas: true, turnstileSiteKey: 'site-key', legal },
    ]);
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
