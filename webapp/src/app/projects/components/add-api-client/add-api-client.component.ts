import { Component, Input, OnDestroy, OnInit } from '@angular/core';
import { FormBuilder, Validators } from '@angular/forms';
import { NgbModal, NgbModalRef } from '@ng-bootstrap/ng-bootstrap';
import { Select, Store } from '@ngxs/store';
import { Observable } from 'rxjs';
import { $enum } from 'ts-enum-util';
import { ProjectClient } from '../../models/project-client';
import { ProjectRole } from '../../models/project-role';
import { AddProjectClient, ClearMessages } from '../../stores/project-client.state';

@Component({
  selector: 'app-add-api-client',
  templateUrl: './add-api-client.component.html',
  styleUrls: ['./add-api-client.component.css'],
})
export class AddApiClientComponent implements OnInit, OnDestroy {
  @Input()
  btnClass = 'btn-light';

  @Input()
  projectId: string;

  @Select(state => state.projectClients.errorMessage)
  errorMessage$: Observable<string | undefined>;

  @Select(state => state.projectClients.isLoading)
  isLoading$: Observable<boolean>;

  modal: NgbModalRef | undefined;

  client: ProjectClient | undefined;

  defaultRole = ProjectRole.Viewer;
  projectRoles = [ProjectRole.Admin, ProjectRole.Editor, ProjectRole.Viewer];

  form = this.fb.group({
    name: ['', [Validators.required]],
    role: [this.defaultRole, [Validators.required]],
  });

  constructor(private modalService: NgbModal, private fb: FormBuilder, private store: Store) {}

  ngOnInit() {}

  ngOnDestroy() {
    this.store.dispatch(new ClearMessages());
  }

  get name() {
    return this.form.get('name');
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

  async addApiClient(nextStep) {
    const name = this.name.value as string;
    const roleString = this.role.value as string;
    const role = ProjectRole[$enum(ProjectRole).getKeyOrThrow(roleString)];
    if (this.projectId && name && role) {
      const stateAfter = await this.store.dispatch(new AddProjectClient(this.projectId, name, role)).toPromise();
      const clients = stateAfter.projectClients.clients;

      // Just added API client will be first element in state.
      if (clients && clients.length > 0) {
        this.client = clients[0];
      }

      this.modal.close();
      this.open(nextStep);
    }
  }

  reset() {
    this.form.reset({
      name: '',
      role: this.defaultRole,
    });
    this.store.dispatch(new ClearMessages());
  }

  copyToClipboard(text) {
    document.addEventListener('copy', (e: ClipboardEvent) => {
      e.clipboardData.setData('text/plain', text);
      e.preventDefault();
      document.removeEventListener('copy', null);
    });
    document.execCommand('copy');
  }
}
