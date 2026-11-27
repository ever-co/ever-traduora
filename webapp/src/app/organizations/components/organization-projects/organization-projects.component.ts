import { AsyncPipe, DecimalPipe, NgFor, NgIf } from '@angular/common';
import { Component, DestroyRef, OnInit, TemplateRef } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { NgbModal, NgbModalRef } from '@ng-bootstrap/ng-bootstrap';
import { Store } from '@ngxs/store';
import { BehaviorSubject } from 'rxjs';
import { distinctUntilChanged, filter, finalize, switchMap } from 'rxjs/operators';
import { Project } from '../../../projects/models/project';
import { ProjectsService } from '../../../projects/services/projects.service';
import { countOf, Organization } from '../../models/organization';
import { organizationErrorMessage } from '../../models/organization-errors';
import { OrganizationsState } from '../../stores/organizations.state';

/** /orgs/:slug/projects: the projects of the organization that the person can see, and "New project" there. */
@Component({
  selector: 'app-organization-projects',
  imports: [NgIf, NgFor, AsyncPipe, DecimalPipe, RouterLink, ReactiveFormsModule],
  templateUrl: './organization-projects.component.html',
  styleUrls: ['./organization-projects.component.css'],
})
export class OrganizationProjectsComponent implements OnInit {
  organization: Organization | undefined;
  readonly projects$ = new BehaviorSubject<Project[] | undefined>(undefined);
  loadError: string | undefined;
  createError: string | undefined;
  creating = false;

  readonly form = this.fb.group({
    name: ['', Validators.compose([Validators.required, Validators.pattern('.*[^ ].*'), Validators.maxLength(255)])],
    description: ['', Validators.maxLength(255)],
  });

  private modal: NgbModalRef | undefined;

  constructor(
    private readonly store: Store,
    private readonly projects: ProjectsService,
    private readonly modals: NgbModal,
    private readonly fb: FormBuilder,
    private readonly router: Router,
    private readonly destroyRef: DestroyRef,
  ) {}

  ngOnInit(): void {
    this.store
      .select(OrganizationsState.currentOrganization)
      .pipe(
        filter((organization): organization is Organization => !!organization),
        distinctUntilChanged((a, b) => a.id === b.id),
        switchMap(organization => {
          this.organization = organization;
          this.projects$.next(undefined);
          return this.projects.find(organization.id);
        }),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: projects => this.projects$.next(projects),
        error: error => (this.loadError = organizationErrorMessage(error)),
      });
  }

  /** "2 projects", or nothing while the list loads. */
  countLine(count: number | undefined): string {
    if (count === undefined) {
      return '';
    }
    return countOf(count, 'project', 'projects');
  }

  /** The strings of a project: what Traduora counts, its terms in each of its locales. */
  strings(project: Project): number {
    return project.termsCount * project.localesCount;
  }

  open(content: TemplateRef<unknown>): void {
    this.form.reset({ name: '', description: '' });
    this.createError = undefined;
    this.modal = this.modals.open(content);
  }

  create(): void {
    if (!this.form.valid || !this.organization || this.creating) {
      return;
    }
    this.creating = true;
    const { name, description } = this.form.getRawValue();
    this.projects
      .create({ name: name as string, description: (description as string) || undefined, organizationId: this.organization.id })
      .pipe(finalize(() => (this.creating = false)))
      .subscribe({
        next: project => {
          this.modal?.close();
          this.router.navigate(['/projects', project.id]);
        },
        error: error => (this.createError = organizationErrorMessage(error)),
      });
  }

  trackById(_: number, project: Project): string {
    return project.id;
  }
}
