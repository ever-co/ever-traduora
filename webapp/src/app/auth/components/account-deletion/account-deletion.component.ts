import { NgFor, NgIf } from '@angular/common';
import { Component, Input, OnChanges, OnDestroy, SimpleChanges } from '@angular/core';
import { AbstractControl, FormControl, FormGroup, ReactiveFormsModule, ValidationErrors, ValidatorFn, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { Store } from '@ngxs/store';
import { Subscription } from 'rxjs';
import { finalize } from 'rxjs/operators';
import { countOf } from '../../../organizations/models/organization';
import { errorToMessage } from '../../../shared/util/api-error';
import { AccountDeletionChoices, AccountDeletionPreflight, DeletionOrganization } from '../../models/account-deletion';
import { User } from '../../models/user';
import { AuthService } from '../../services/auth.service';
import { ClearMessages, DeleteAccount } from '../../stores/auth.state';

type Choices = FormGroup<Record<string, FormControl<string>>>;

/** Valid when the typed text, trimmed, is exactly what `expected` gives at the time of the check. */
function typedExactly(expected: () => string): ValidatorFn {
  return (control: AbstractControl): ValidationErrors | null => {
    const wanted = expected();
    return wanted && String(control.value ?? '').trim() === wanted ? null : { mismatch: true };
  };
}

function choices(ids: string[], validator: (id: string) => ValidatorFn): Choices {
  const controls: Record<string, FormControl<string>> = {};
  for (const id of ids) {
    controls[id] = new FormControl('', { nonNullable: true, validators: validator(id) });
  }
  return new FormGroup(controls);
}

/**
 * Account settings → Delete account. It first asks the API what stands in the way: nothing, and the person confirms
 * with their email as before; otherwise they choose, in the page, who becomes the admin of each project they are the
 * last admin of and who owns each organization they own with others, and confirm the deletion of each organization they
 * are the only member of by typing its address. An organization an operator suspended blocks the deletion until support
 * restores it. Everything goes in one request, through the DeleteAccount action.
 */
@Component({
  selector: 'app-account-deletion',
  imports: [NgIf, NgFor, ReactiveFormsModule, RouterLink],
  templateUrl: './account-deletion.component.html',
  styleUrls: ['./account-deletion.component.css'],
})
export class AccountDeletionComponent implements OnChanges, OnDestroy {
  @Input({ required: true }) user!: User;

  step: 'idle' | 'checking' | 'confirm' = 'idle';
  preflight: AccountDeletionPreflight | undefined;
  /** Organizations the person owns with other members: one of them becomes the owner. */
  ownedWithOthers: DeletionOrganization[] = [];
  /** Organizations the person is the only member of: deleted with the account. */
  ownedAlone: DeletionOrganization[] = [];
  /** Organizations an operator suspended: the account cannot be deleted until support restores them. */
  blocked: DeletionOrganization[] = [];
  busy = false;
  errorMessage: string | undefined;

  form = this.buildForm({ projects: [], organizations: [] });

  private check: Subscription | undefined;

  constructor(
    private readonly store: Store,
    private readonly authService: AuthService,
  ) {}

  get simple(): boolean {
    return !!this.preflight && this.preflight.projects.length === 0 && this.preflight.organizations.length === 0;
  }

  get submitLabel(): string {
    return this.ownedAlone.length ? `Delete my account and ${countOf(this.ownedAlone.length, 'organization', 'organizations')}` : 'Delete my account';
  }

  projectsLine(organization: DeletionOrganization): string {
    return organization.projectsCount === 0 ? 'no projects' : countOf(organization.projectsCount, 'project', 'projects');
  }

  /** Asks what stands in the way, then shows the confirmation (again after an error, with the answer of now). */
  start(): void {
    if (this.step === 'checking') {
      return;
    }
    this.step = 'checking';
    this.errorMessage = undefined;
    this.check?.unsubscribe();
    this.check = this.authService.accountDeletion().subscribe({
      next: preflight => {
        this.preflight = preflight;
        this.blocked = preflight.organizations.filter(organization => organization.status === 'suspended');
        const open = preflight.organizations.filter(organization => organization.status !== 'suspended');
        this.ownedWithOthers = open.filter(organization => !organization.onlyMember);
        this.ownedAlone = open.filter(organization => organization.onlyMember);
        this.form = this.buildForm(preflight);
        this.step = 'confirm';
      },
      error: error => {
        this.step = this.preflight ? 'confirm' : 'idle';
        this.errorMessage = errorToMessage(error);
      },
    });
  }

  cancel(): void {
    if (this.busy) {
      // The deletion is on its way: its answer decides what the page shows
      return;
    }
    this.check?.unsubscribe();
    this.step = 'idle';
    this.preflight = undefined;
    this.ownedWithOthers = [];
    this.ownedAlone = [];
    this.blocked = [];
    this.errorMessage = undefined;
    this.form = this.buildForm({ projects: [], organizations: [] });
  }

  /** The body of `DELETE /users/me`, or none when there is nothing to decide. */
  choices(): AccountDeletionChoices | undefined {
    const preflight = this.preflight;
    if (!preflight) {
      return undefined;
    }
    const { admins, owners, slugs } = this.form.getRawValue();
    const body: AccountDeletionChoices = {};
    if (preflight.projects.length) {
      body.projectAdmins = preflight.projects.map(project => ({ projectId: project.id, userId: admins[project.id] }));
    }
    if (this.ownedWithOthers.length) {
      body.organizationOwners = this.ownedWithOthers.map(organization => ({ organizationId: organization.id, userId: owners[organization.id] }));
    }
    if (this.ownedAlone.length) {
      body.deleteOrganizations = this.ownedAlone.map(organization => ({ organizationId: organization.id, slug: slugs[organization.id].trim() }));
    }
    return Object.keys(body).length ? body : undefined;
  }

  submit(): void {
    this.form.markAllAsTouched();
    if (this.step !== 'confirm' || this.form.invalid || this.busy || this.blocked.length > 0) {
      return;
    }
    this.busy = true;
    this.errorMessage = undefined;
    this.store
      .dispatch(new DeleteAccount(this.choices()))
      .pipe(finalize(() => (this.busy = false)))
      .subscribe({
        // Deleted: the session ends and the sign-in page says so
        error: () => {
          // The message is shown here, by the form, rather than at the top of the page
          this.errorMessage = this.store.selectSnapshot(state => state.auth?.errorMessage) || 'Your account could not be deleted. Please try again.';
          this.store.dispatch(new ClearMessages());
        },
      });
  }

  /** Another account, or a changed email: the typed confirmation is checked against the email of now. */
  ngOnChanges(changes: SimpleChanges): void {
    if (changes['user'] && !changes['user'].firstChange) {
      this.form.controls.email.updateValueAndValidity();
    }
  }

  ngOnDestroy(): void {
    this.check?.unsubscribe();
  }

  private buildForm(preflight: AccountDeletionPreflight) {
    // A suspended organization gets no choice: it blocks the deletion
    const organizations = preflight.organizations.filter(organization => organization.status !== 'suspended');
    const slugOf = new Map(organizations.map(organization => [organization.id, organization.slug]));
    return new FormGroup({
      email: new FormControl('', { nonNullable: true, validators: [Validators.required, typedExactly(() => this.user?.email ?? '')] }),
      admins: choices(
        preflight.projects.map(project => project.id),
        () => Validators.required,
      ),
      owners: choices(
        organizations.filter(organization => !organization.onlyMember).map(organization => organization.id),
        () => Validators.required,
      ),
      slugs: choices(
        organizations.filter(organization => organization.onlyMember).map(organization => organization.id),
        id => typedExactly(() => slugOf.get(id) ?? ''),
      ),
    });
  }
}
