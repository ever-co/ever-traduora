import { AsyncPipe, NgIf } from '@angular/common';
import { Component, OnDestroy, OnInit } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { Store } from '@ngxs/store';
import { Subscription } from 'rxjs';
import { finalize } from 'rxjs/operators';
import { isAllowedSlug, slugFromName } from '../../models/organization';
import { ClearOrganizationMessages, CreateOrganization, GetOrganizations, OrganizationsState } from '../../stores/organizations.state';

/** /orgs/new: another organization, with the person as its owner on the Starter plan. */
@Component({
  selector: 'app-new-organization',
  imports: [NgIf, AsyncPipe, ReactiveFormsModule, RouterLink],
  templateUrl: './new-organization.component.html',
  styleUrls: ['./new-organization.component.css'],
})
export class NewOrganizationComponent implements OnInit, OnDestroy {
  readonly form = this.fb.group({
    name: ['', Validators.compose([Validators.required, Validators.minLength(2), Validators.maxLength(80), Validators.pattern('.*[^ ].*')])],
    slug: ['', Validators.compose([Validators.required, control => (isAllowedSlug(control.value || '') ? null : { slug: true })])],
  });

  readonly organizations$ = this.store.select(OrganizationsState.organizations);
  readonly errorMessage$ = this.store.select(OrganizationsState.errorMessage);
  busy = false;

  /** The address follows the name until the person edits it. */
  private slugEdited = false;
  private nameChanges: Subscription | undefined;

  constructor(
    private readonly fb: FormBuilder,
    private readonly store: Store,
    private readonly router: Router,
  ) {}

  ngOnInit(): void {
    this.store.dispatch(new ClearOrganizationMessages());
    if (!this.store.selectSnapshot(OrganizationsState.loaded)) {
      this.store.dispatch(new GetOrganizations());
    }
    this.nameChanges = this.form.controls.name.valueChanges.subscribe(name => {
      if (!this.slugEdited) {
        this.form.controls.slug.setValue(slugFromName(name || ''));
      }
    });
  }

  ngOnDestroy(): void {
    this.nameChanges?.unsubscribe();
  }

  slugInput(): void {
    this.slugEdited = true;
  }

  create(): void {
    if (!this.form.valid || this.busy) {
      return;
    }
    const { name, slug } = this.form.getRawValue();
    this.busy = true;
    this.store
      .dispatch(new CreateOrganization((name as string).trim(), slug as string))
      .pipe(finalize(() => (this.busy = false)))
      .subscribe({
        next: () => this.router.navigate(['/orgs', slug, 'projects']),
        // The message is in the state
        error: () => undefined,
      });
  }
}
