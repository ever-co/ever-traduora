import { Component, Input, OnDestroy, OnInit } from '@angular/core';
import { FormBuilder, Validators } from '@angular/forms';
import { NgbModal, NgbModalRef } from '@ng-bootstrap/ng-bootstrap';
import { Select, Store } from '@ngxs/store';
import { Observable } from 'rxjs';
import { Project } from '../../models/project';
import { ClearMessages, CreateProjectTag } from '../../stores/project-tag.state';
import * as _ from 'lodash';

@Component({
  selector: 'app-new-tag',
  templateUrl: './new-tag.component.html',
  styleUrls: ['./new-tag.component.css'],
})
export class NewTagComponent implements OnInit, OnDestroy {
  @Input()
  btnClass = 'btn-light';

  @Input()
  project: Project;

  @Input()
  availableColors: string[] = [];

  form = this.fb.group({
    value: ['', Validators.compose([Validators.required, Validators.maxLength(30), Validators.pattern('.*[^ ].*')])],
    color: ['', Validators.compose([Validators.required, Validators.pattern('^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$')])],
  });

  @Select(state => state.projectTags.isLoading)
  isLoading$: Observable<boolean>;

  @Select(state => state.projectTags.errorMessage)
  errorMessage$: Observable<string | undefined>;

  modal: NgbModalRef | undefined;

  constructor(private modalService: NgbModal, private fb: FormBuilder, private store: Store) {}

  ngOnInit() {}

  ngOnDestroy() {
    this.reset();
  }

  randomColor() {
    const choice = _.sample(this.availableColors);
    if (choice) this.color.setValue(choice);
  }

  open(content) {
    this.randomColor();
    this.modal = this.modalService.open(content);
    this.modal.result.then(() => this.reset(), () => this.reset());
  }

  async onSubmit() {
    if (!this.form.valid) {
      return;
    }
    await this.store.dispatch(new CreateProjectTag(this.project.id, this.value.value as string, this.color.value as string)).toPromise();
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
