import { AsyncPipe, NgFor, NgIf } from '@angular/common';
import { Component, DestroyRef, OnInit } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Router, RouterLink } from '@angular/router';
import { NgbDropdownModule } from '@ng-bootstrap/ng-bootstrap';
import { Store } from '@ngxs/store';
import { combineLatest, Observable } from 'rxjs';
import { distinctUntilChanged, filter, map } from 'rxjs/operators';
import { AuthState } from '../../../auth/stores/auth.state';
import { ProjectsState } from '../../../projects/stores/projects.state';
import { Organization } from '../../models/organization';
import { SaasModeService } from '../../services/saas-mode.service';
import { GetOrganizations, OrganizationsState, SetCurrentOrganization } from '../../stores/organizations.state';

/**
 * The organization switcher, right after the "traduora" wordmark in the app bar: the current organization's name with a
 * chevron, the person's organizations, and "New organization". Shown only in SaaS mode, to a signed-in person.
 */
@Component({
  selector: 'app-organization-switcher',
  imports: [NgIf, NgFor, AsyncPipe, RouterLink, NgbDropdownModule],
  templateUrl: './organization-switcher.component.html',
  styleUrls: ['./organization-switcher.component.css'],
})
export class OrganizationSwitcherComponent implements OnInit {
  readonly visible$: Observable<boolean>;
  readonly organizations$: Observable<Organization[]>;
  readonly current$: Observable<Organization | undefined>;

  constructor(
    private readonly store: Store,
    private readonly router: Router,
    private readonly destroyRef: DestroyRef,
    saasMode: SaasModeService,
  ) {
    const user$ = this.store.select(AuthState.user);
    this.visible$ = combineLatest([saasMode.saas$, user$]).pipe(map(([saas, user]) => saas && !!user));
    // By name, so the list reads the same however the organizations were joined
    this.organizations$ = this.store
      .select(OrganizationsState.organizations)
      .pipe(map(organizations => [...organizations].sort((a, b) => a.name.localeCompare(b.name))));
    this.current$ = this.store.select(OrganizationsState.currentOrganization);
  }

  ngOnInit(): void {
    // The list, once signed in (again after a logout)
    this.visible$.pipe(filter(Boolean), takeUntilDestroyed(this.destroyRef)).subscribe(() => {
      if (!this.store.selectSnapshot(OrganizationsState.loaded)) {
        this.store.dispatch(new GetOrganizations());
      }
    });
    // On a project page, the current organization is the project's
    this.store
      .select(ProjectsState.currentProject)
      .pipe(
        map(project => project?.organizationId),
        // Before the filter: a project page left (no project) resets the comparison, so coming back to a project of
        // the organization seen before still sets it
        distinctUntilChanged(),
        filter((id): id is string => !!id),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe(id => this.store.dispatch(new SetCurrentOrganization(id)));
  }

  switchTo(organization: Organization): void {
    this.store.dispatch(new SetCurrentOrganization(organization.id));
    this.router.navigate(['/orgs', organization.slug, 'projects']);
  }

  trackById(_: number, organization: Organization): string {
    return organization.id;
  }
}
