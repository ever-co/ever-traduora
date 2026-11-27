import { Injectable } from '@angular/core';
import { Action, Selector, State, StateContext } from '@ngxs/store';
import { throwError } from 'rxjs';
import { catchError, finalize, tap } from 'rxjs/operators';
import { Logout } from '../../auth/stores/auth.state';
import { organizationErrorMessage } from '../models/organization-errors';
import { Organization } from '../models/organization';
import { OrganizationsService } from '../services/organizations.service';

/** Where the browser remembers the organization last worked in, for the next visit. */
export const CURRENT_ORGANIZATION_KEY = 'tr.currentOrganization';

export function rememberedOrganizationId(): string | undefined {
  try {
    return window.localStorage.getItem(CURRENT_ORGANIZATION_KEY) || undefined;
  } catch {
    return undefined;
  }
}

function rememberOrganization(id: string | undefined): void {
  try {
    if (id) {
      window.localStorage.setItem(CURRENT_ORGANIZATION_KEY, id);
    } else {
      window.localStorage.removeItem(CURRENT_ORGANIZATION_KEY);
    }
  } catch {
    // Private windows and blocked storage: the organization is simply not remembered
  }
}

export class GetOrganizations {
  static readonly type = '[Organizations] Get organizations';
}

/** By id: from the URL of an organization page (resolved from its slug) or from the project of a project page. */
export class SetCurrentOrganization {
  static readonly type = '[Organizations] Set current organization';
  constructor(public id: string) {}
}

export class CreateOrganization {
  static readonly type = '[Organizations] Create organization';
  constructor(
    public name: string,
    public slug?: string,
  ) {}
}

export class UpdateOrganization {
  static readonly type = '[Organizations] Update organization';
  constructor(
    public id: string,
    public data: { name?: string; slug?: string },
  ) {}
}

/** After a change of membership elsewhere (a transfer of ownership, leaving), the list is read again. */
export class ReplaceOrganization {
  static readonly type = '[Organizations] Replace organization';
  constructor(public organization: Organization) {}
}

export class ClearOrganizationMessages {
  static readonly type = '[Organizations] Clear messages';
}

export interface OrganizationsStateModel {
  organizations: Organization[];
  loaded: boolean;
  currentOrganizationId: string | undefined;
  isLoading: boolean;
  errorMessage: string | undefined;
}

const stateDefaults: OrganizationsStateModel = {
  organizations: [],
  loaded: false,
  currentOrganizationId: undefined,
  isLoading: false,
  errorMessage: undefined,
};

/**
 * The person's organizations and the one they work in. The current one comes from the URL on organization pages and
 * from the project on project pages, and the browser remembers it for the next visit.
 */
@State<OrganizationsStateModel>({
  name: 'organizations',
  defaults: stateDefaults,
})
@Injectable({ providedIn: 'root' })
export class OrganizationsState {
  /** Bumped by Logout: answers to requests sent before belong to the previous account and are dropped. */
  private session = 0;
  /** Bumped by every change made to the list here: a list read before it would undo the change, so it is read again. */
  private revision = 0;

  constructor(private readonly organizationsService: OrganizationsService) {}

  @Selector()
  static organizations(state: OrganizationsStateModel) {
    return state.organizations;
  }

  @Selector()
  static loaded(state: OrganizationsStateModel) {
    return state.loaded;
  }

  @Selector()
  static isLoading(state: OrganizationsStateModel) {
    return state.isLoading;
  }

  @Selector()
  static errorMessage(state: OrganizationsStateModel) {
    return state.errorMessage;
  }

  /** The current organization, else the remembered one, else the first: what the switcher shows. */
  @Selector()
  static currentOrganization(state: OrganizationsStateModel): Organization | undefined {
    const wanted = state.currentOrganizationId ?? rememberedOrganizationId();
    return state.organizations.find(organization => organization.id === wanted) ?? state.organizations[0];
  }

  @Action(Logout)
  logout(ctx: StateContext<OrganizationsStateModel>) {
    this.session++;
    ctx.setState(stateDefaults);
  }

  @Action(GetOrganizations)
  getOrganizations(ctx: StateContext<OrganizationsStateModel>) {
    const session = this.session;
    const revision = this.revision;
    ctx.patchState({ isLoading: true });
    return this.organizationsService.find().pipe(
      tap(organizations => {
        if (session !== this.session) {
          return;
        }
        if (revision !== this.revision) {
          // Read before a change made here meanwhile: read again rather than undo it
          ctx.dispatch(new GetOrganizations());
          return;
        }
        ctx.patchState({ organizations, loaded: true });
      }),
      catchError(error => {
        if (session === this.session) {
          ctx.patchState({ errorMessage: organizationErrorMessage(error) });
        }
        return throwError(() => error);
      }),
      finalize(() => {
        if (session === this.session) {
          ctx.patchState({ isLoading: false });
        }
      }),
    );
  }

  @Action(SetCurrentOrganization)
  setCurrentOrganization(ctx: StateContext<OrganizationsStateModel>, action: SetCurrentOrganization) {
    ctx.patchState({ currentOrganizationId: action.id });
    rememberOrganization(action.id);
  }

  @Action(CreateOrganization)
  createOrganization(ctx: StateContext<OrganizationsStateModel>, action: CreateOrganization) {
    ctx.patchState({ isLoading: true, errorMessage: undefined });
    return this.organizationsService.create({ name: action.name, ...(action.slug ? { slug: action.slug } : {}) }).pipe(
      tap(organization => {
        this.revision++;
        ctx.patchState({ organizations: [...ctx.getState().organizations, organization], currentOrganizationId: organization.id });
        rememberOrganization(organization.id);
      }),
      catchError(error => {
        ctx.patchState({ errorMessage: organizationErrorMessage(error) });
        return throwError(() => error);
      }),
      finalize(() => ctx.patchState({ isLoading: false })),
    );
  }

  @Action(UpdateOrganization)
  updateOrganization(ctx: StateContext<OrganizationsStateModel>, action: UpdateOrganization) {
    ctx.patchState({ isLoading: true, errorMessage: undefined });
    return this.organizationsService.update(action.id, action.data).pipe(
      tap(organization => {
        this.revision++;
        ctx.dispatch(new ReplaceOrganization(organization));
      }),
      catchError(error => {
        ctx.patchState({ errorMessage: organizationErrorMessage(error) });
        return throwError(() => error);
      }),
      finalize(() => ctx.patchState({ isLoading: false })),
    );
  }

  @Action(ReplaceOrganization)
  replaceOrganization(ctx: StateContext<OrganizationsStateModel>, action: ReplaceOrganization) {
    ctx.patchState({
      organizations: ctx
        .getState()
        .organizations.map(organization => (organization.id === action.organization.id ? action.organization : organization)),
    });
  }

  @Action(ClearOrganizationMessages)
  clearMessages(ctx: StateContext<OrganizationsStateModel>) {
    ctx.patchState({ errorMessage: undefined });
  }
}
