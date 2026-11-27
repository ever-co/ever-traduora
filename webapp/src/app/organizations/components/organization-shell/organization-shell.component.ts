import { AsyncPipe, NgIf } from '@angular/common';
import { Component, DestroyRef, OnInit } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { Store } from '@ngxs/store';
import { combineLatest, Observable, of } from 'rxjs';
import { catchError, map, switchMap, tap } from 'rxjs/operators';
import { canManage, Organization, PLAN_NAMES } from '../../models/organization';
import { GetOrganizations, OrganizationsState, SetCurrentOrganization } from '../../stores/organizations.state';

/** The frame of the organization pages (/orgs/:slug/...): the organization's name, its address and the tabs. */
@Component({
  selector: 'app-organization-shell',
  imports: [NgIf, AsyncPipe, RouterLink, RouterLinkActive, RouterOutlet],
  templateUrl: './organization-shell.component.html',
  styleUrls: ['./organization-shell.component.css'],
})
export class OrganizationShellComponent implements OnInit {
  /** The organization of the address, once the list is loaded; null when the person has none with this slug. */
  organization$: Observable<Organization | null | undefined>;
  readonly planNames = PLAN_NAMES;
  readonly canManage = canManage;

  constructor(
    private readonly route: ActivatedRoute,
    private readonly store: Store,
    private readonly destroyRef: DestroyRef,
  ) {}

  ngOnInit(): void {
    const loaded$ = this.store.select(OrganizationsState.loaded).pipe(
      switchMap(loaded => (loaded ? of(true) : this.store.dispatch(new GetOrganizations()).pipe(map(() => true)))),
      // Without the list, the page says the organization is not found
      catchError(() => of(true)),
    );
    this.organization$ = combineLatest([this.route.paramMap.pipe(map(params => params.get('slug'))), loaded$]).pipe(
      switchMap(([slug]) =>
        this.store.select(OrganizationsState.organizations).pipe(map(organizations => organizations.find(o => o.slug === slug) ?? null)),
      ),
      tap(organization => {
        if (organization && organization.id !== this.store.selectSnapshot(OrganizationsState.currentOrganization)?.id) {
          this.store.dispatch(new SetCurrentOrganization(organization.id));
        }
      }),
      takeUntilDestroyed(this.destroyRef),
    );
  }
}
