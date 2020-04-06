import { Component, Input, OnDestroy, OnInit } from '@angular/core';
import { FormBuilder, Validators } from '@angular/forms';
import { NgbModal, NgbModalRef } from '@ng-bootstrap/ng-bootstrap';
import { Select, Store } from '@ngxs/store';
import { Observable } from 'rxjs';
import { ClearMessages, CreateProject } from '../../stores/projects.state';

@Component({
  selector: 'app-new-project',
  templateUrl: './new-project.component.html',
  styleUrls: ['./new-project.component.css'],
})
export class NewProjectComponent implements OnInit, OnDestroy {
  @Input()
  btnClass = 'btn-light';

  form = this.fb.group({
    name: ['', Validators.compose([Validators.required, Validators.pattern('.*[^ ].*')])],
    description: [''],
  });

  @Select(state => state.projects.isLoading)
  isLoading$: Observable<boolean>;

  @Select(state => state.projects.errorMessage)
  errorMessage$: Observable<string | undefined>;

  modal: NgbModalRef | undefined;

  constructor(private modalService: NgbModal, private fb: FormBuilder, private store: Store) {}

  ngOnInit() {}

  ngOnDestroy() {
    this.reset();
  }

  open(content) {
    this.modal = this.modalService.open(content);
    this.modal.result.then(
      () => this.reset(),
      () => this.reset(),
    );
  }

  async onSubmit() {
    if (!this.form.valid) {
      return;
    }
    await this.store.dispatch(new CreateProject(this.name.value as string, this.description.value as string)).toPromise();
    this.modal.close();
  }

  get name() {
    return this.form.get('name');
  }

  get description() {
    return this.form.get('description');
  }

  reset() {
    this.form.reset();
    this.store.dispatch(new ClearMessages());
  }
}
