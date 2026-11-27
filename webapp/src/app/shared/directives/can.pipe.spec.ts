import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { NgxsModule, Store } from '@ngxs/store';
import { firstValueFrom } from 'rxjs';
import { ProjectUserState } from '../../projects/stores/project-user.state';
import { ProjectsState } from '../../projects/stores/projects.state';
import { CanGuard } from '../guards/can.guard';
import { CanPipe } from './can.pipe';

describe('CanPipe and CanGuard', () => {
  let store: Store;

  /** The current project as the API answers it (with the effective role), and the person's row in its member list. */
  const given = (projectRole: string | undefined, memberRole: string | undefined) =>
    store.reset({
      ...store.snapshot(),
      projects: {
        ...store.snapshot().projects,
        currentProject: projectRole ? { id: 'p1', name: 'Site', role: projectRole, termsCount: 0, localesCount: 0 } : undefined,
      },
      projectUsers: {
        ...store.snapshot().projectUsers,
        users: memberRole ? [{ userId: 'u1', name: 'Ada', email: 'ada@example.test', role: memberRole, isSelf: true }] : [],
      },
    });

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [NgxsModule.forRoot([ProjectsState, ProjectUserState])],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    store = TestBed.inject(Store);
  });

  it("follows the project's effective role: an organization admin without a project membership can edit", async () => {
    given('admin', undefined);
    const pipe = new CanPipe(store);
    expect(await firstValueFrom(pipe.transform(true, 'EditProject'))).toBe(true);
    expect(await firstValueFrom(pipe.transform(true, 'ImportTranslation'))).toBe(true);
  });

  it('prefers the effective role to a lower stored membership', async () => {
    given('admin', 'viewer');
    expect(await firstValueFrom(new CanPipe(store).transform(true, 'DeleteProject'))).toBe(true);
  });

  it('keeps refusing what the role does not allow', async () => {
    given('viewer', 'viewer');
    expect(await firstValueFrom(new CanPipe(store).transform(true, 'EditTerm'))).toBe(false);
    expect(await firstValueFrom(new CanPipe(store).transform(false, 'ViewTerm'))).toBe(false);
  });

  it('opens a page for the effective role once the project is loaded', async () => {
    given('admin', undefined);
    const guard = TestBed.inject(CanGuard);
    const route: any = { data: { roles: ['admin', 'editor'] }, paramMap: new Map(), parent: { paramMap: new Map([['projectId', 'p1']]) } };
    expect(await firstValueFrom(guard.canActivate(route))).toBe(true);
    given('viewer', 'admin');
    expect(await firstValueFrom(guard.canActivate(route))).toBe(false);
  });
});
