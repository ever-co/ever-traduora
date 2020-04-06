import { Component, Input, OnDestroy, OnInit } from '@angular/core';
import { FormBuilder, Validators } from '@angular/forms';
import { NgbModal, NgbModalRef } from '@ng-bootstrap/ng-bootstrap';
import { Select, Store } from '@ngxs/store';
import { Observable } from 'rxjs';
import { $enum } from 'ts-enum-util';
import { ProjectRole } from '../../models/project-role';
import { ClearMessages } from '../../stores/project-user.state';
import { AddProjectInvite } from '../../stores/project-invite.state';

@Component({
  selector: 'app-add-team-member',
  templateUrl: './add-team-member.component.html',
  styleUrls: ['./add-team-member.component.css'],
})
export class AddTeamMemberComponent implements OnInit, OnDestroy {
  @Input()
  btnClass = 'btn-light';

  @Input()
  projectId: string;

  @Select(state => state.projectUsers.errorMessage)
  errorMessage$: Observable<string | undefined>;

  @Select(state => state.projectUsers.isLoading)
  isLoading$: Observable<boolean>;

  modal: NgbModalRef | undefined;

  defaultRole = ProjectRole.Editor;
  projectRoles = [ProjectRole.Admin, ProjectRole.Editor, ProjectRole.Viewer];

  form = this.fb.group({
    email: ['', [Validators.required, Validators.email]],
    role: [this.defaultRole, [Validators.required]],
  });

  constructor(private modalService: NgbModal, private fb: FormBuilder, private store: Store) {}

  ngOnInit() {}

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
    const email = this.email.value as string;
    const roleString = this.role.value as string;
    const role = ProjectRole[$enum(ProjectRole).getKeyOrThrow(roleString)];
    if (this.projectId && email && role) {
      await this.store.dispatch(new AddProjectInvite(this.projectId, email, role)).toPromise();
      this.modal.close();
    }
  }

  reset() {
    this.form.reset({
      email: '',
      role: this.defaultRole,
    });
    this.store.dispatch(new ClearMessages());
  }
}
