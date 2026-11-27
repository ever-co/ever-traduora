import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { convertToParamMap } from '@angular/router';
import { Navigate } from '@ngxs/router-plugin';
import { NgxsModule, Store } from '@ngxs/store';
import { firstValueFrom, isObservable, Observable } from 'rxjs';
import { AuthState } from '../stores/auth.state';
import { NoAuthGuard } from './no-auth.guard';

describe('NoAuthGuard', () => {
  let store: Store;
  let dispatched: unknown[];

  const open = async (query: Record<string, string>) => {
    const result = TestBed.inject(NoAuthGuard).canActivate({ queryParamMap: convertToParamMap(query) } as any, {} as any);
    return isObservable(result) ? firstValueFrom(result as Observable<boolean>) : result;
  };

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [NgxsModule.forRoot([AuthState])],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    store = TestBed.inject(Store);
    store.reset({ ...store.snapshot(), auth: { ...store.snapshot().auth, isAuthenticated: true } });
    dispatched = [];
    spyOn(store, 'dispatch').and.callFake((action: unknown) => {
      dispatched.push(action);
      return undefined as any;
    });
  });

  it("sends a signed-in person's organization invitation link to its acceptance, keeping kind", async () => {
    expect(await open({ invite: 't1', kind: 'organization' })).toBe(false);
    expect(dispatched).toEqual([new Navigate(['/accept-invite'], { invite: 't1', kind: 'organization' })]);
  });

  it('keeps the address of a project invitation link as it was', async () => {
    expect(await open({ invite: 't2' })).toBe(false);
    expect(dispatched).toEqual([new Navigate(['/accept-invite'], { invite: 't2' })]);
  });
});
