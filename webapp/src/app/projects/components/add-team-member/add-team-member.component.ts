import { Component, Input, OnDestroy } from '@angular/core';
import { FormBuilder, Validators } from '@angular/forms';
import { NgbModal, NgbModalRef } from '@ng-bootstrap/ng-bootstrap';
import { Select, Store } from '@ngxs/store';
import { Observable } from 'rxjs';
import { $enum } from 'ts-enum-util';
import { ProjectRole } from '../../models/project-role';
import { AddProjectInvite, ClearMessages, ProjectInviteState } from '../../stores/project-invite.state';

@Component({
  standalone: false,
  selector: 'app-add-team-member',
  templateUrl: './add-team-member.component.html',
  styleUrls: ['./add-team-member.component.css'],
})
export class AddTeamMemberComponent implements OnDestroy {
  @Input()
  btnClass = 'btn-light';

  @Input()
  projectId: string;

  // Inviting goes through the invite state, so its errors and progress are the ones to show
  @Select(state => state.projectInvites.errorMessage)
  errorMessage$: Observable<string | undefined>;

  @Select(ProjectInviteState.isLoading)
  isLoading$: Observable<boolean>;

  private isSubmitting = false;

  modal: NgbModalRef | undefined;

  // Set after inviting someone without an account, so the admin can share the link if the email does not arrive
  inviteUrl: string | undefined;
  invitedEmail: string | undefined;

  defaultRole = ProjectRole.Editor;
  projectRoles = [ProjectRole.Admin, ProjectRole.Editor, ProjectRole.Viewer];

  form = this.fb.group({
    email: ['', [Validators.required, Validators.email]],
    role: [this.defaultRole, [Validators.required]],
  });

  constructor(
    private modalService: NgbModal,
    private fb: FormBuilder,
    private store: Store,
  ) {}

  ngOnDestroy() {
    this.store.dispatch(new ClearMessages());
  }

  get email() {
    return this.form.get('email');
  }

  get role() {
    return this.form.get('role');
  }

  open(content) {
    this.modal = this.modalService.open(content);
    this.modal.result.then(
      () => this.reset(),
      () => this.reset(),
    );
  }

  async addTeamMember() {
    // Submitting again, while sending or once the link is showing, would send a new link and invalidate the previous one
    if (this.inviteUrl || this.isSubmitting) {
      return;
    }
    const email = this.email.value as string;
    const roleString = this.role.value as string;
    const role = ProjectRole[$enum(ProjectRole).getKeyOrThrow(roleString)];
    if (this.projectId && email && role) {
      const modal = this.modal;
      this.isSubmitting = true;
      try {
        await this.store.dispatch(new AddProjectInvite(this.projectId, email, role)).toPromise();
      } catch {
        // The invite state holds the error message shown in the modal
        return;
      } finally {
        this.isSubmitting = false;
      }
      // The modal was closed while sending: do not show this link the next time it opens
      if (this.modal !== modal) {
        return;
      }
      const added = this.store.selectSnapshot(ProjectInviteState.lastAdded);
      if (added && 'inviteUrl' in added && added.inviteUrl) {
        this.invitedEmail = added.email;
        this.inviteUrl = added.inviteUrl;
      } else {
        this.modal.close();
      }
    }
  }

  copyInviteUrl(input: HTMLInputElement) {
    // Selecting the link also lets the admin copy it by hand if the browser refuses
    input.select();
    // The Clipboard API only exists on HTTPS, self-hosted instances often run on plain HTTP
    const copySelection = () => document.execCommand('copy');
    if (navigator.clipboard) {
      navigator.clipboard.writeText(input.value).catch(copySelection);
    } else {
      copySelection();
    }
  }

  reset() {
    this.modal = undefined;
    this.inviteUrl = undefined;
    this.invitedEmail = undefined;
    this.form.reset({
      email: '',
      role: this.defaultRole,
    });
    this.store.dispatch(new ClearMessages());
  }
}
