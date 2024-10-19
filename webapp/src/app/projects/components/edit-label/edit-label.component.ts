import { Component, Input, OnDestroy, OnInit } from '@angular/core';
import { UntypedFormBuilder, Validators } from '@angular/forms';
import { NgbModal, NgbModalRef } from '@ng-bootstrap/ng-bootstrap';
import { Select, Store } from '@ngxs/store';
import * as _ from 'lodash';
import { Observable } from 'rxjs';
import { Label, TAG_COLORS } from '../../models/label';
import { Project } from '../../models/project';
import { ClearMessages, UpdateProjectLabel } from '../../stores/project-label.state';

@Component({
  selector: 'app-edit-label',
  templateUrl: './edit-label.component.html',
  styleUrls: ['./edit-label.component.css'],
})
export class EditLabelComponent implements OnInit, OnDestroy {
  @Input()
  project: Project;

  @Input()
  label: Label;

  form = this.fb.group({
    value: ['', Validators.compose([Validators.required, Validators.maxLength(30), Validators.pattern('.*[^ ].*')])],
    color: ['', Validators.compose([Validators.required, Validators.pattern('^#[A-Fa-f0-9]{6}$')])],
  });

  @Select(state => state.projectLabels.isLoading)
  isLoading$: Observable<boolean>;

  @Select(state => state.projectLabels.errorMessage)
  errorMessage$: Observable<string | undefined>;

  modal: NgbModalRef | undefined;

  constructor(
    private modalService: NgbModal,
    private fb: UntypedFormBuilder,
    private store: Store,
  ) {}

  ngOnInit() {}

  ngOnDestroy() {
    this.reset();
  }

  randomColor() {
    const choice = _.sample(TAG_COLORS);
    if (choice) {
      this.color.setValue(choice);
    }
  }

  open(content) {
    if (this.label.value) {
      this.value.setValue(this.label.value);
    }
    if (this.label.color) {
      this.color.setValue(this.label.color);
    } else {
      this.randomColor();
    }
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
    await this.store
      .dispatch(new UpdateProjectLabel(this.project.id, this.label.id, this.value.value as string, this.color.value as string))
      .toPromise();
    this.modal.close();
  }

  get value() {
    return this.form.get('value');
  }

  get color() {
    return this.form.get('color');
  }

  reset() {
    this.form.reset();
    this.store.dispatch(new ClearMessages());
  }
}
