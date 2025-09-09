import { Component, Input, OnDestroy } from '@angular/core';
import { FormBuilder, Validators } from '@angular/forms';
import { NgbModal, NgbModalRef } from '@ng-bootstrap/ng-bootstrap';
import { Select, Store } from '@ngxs/store';
import { Observable } from 'rxjs';
import { Project } from '../../models/project';
import { ClearMessages, CreateTerm } from '../../stores/terms.state';

@Component({
  selector: 'app-new-term',
  templateUrl: './new-term.component.html',
  styleUrls: ['./new-term.component.css'],
})
export class NewTermComponent implements OnDestroy {
  @Input()
  btnClass = 'btn-light';

  @Input()
  project: Project;

  form = this.fb.group({
    term: ['', Validators.compose([Validators.required, Validators.pattern('.*[^ ].*')])],
    context: [''],
  });

  @Select(state => state.terms.isLoading)
  isLoading$: Observable<boolean>;

  @Select(state => state.terms.errorMessage)
  errorMessage$: Observable<string | undefined>;

  modal: NgbModalRef | undefined;

  constructor(
    private modalService: NgbModal,
    private fb: FormBuilder,
    private store: Store,
  ) {}

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

    await this.store.dispatch(new CreateTerm(this.project.id, this.term.value as string, this.context.value as string | undefined)).toPromise();

    this.modal.close();
  }

  get term() {
    return this.form.get('term');
  }

  get context() {
    return this.form.get('context');
  }

  reset() {
    this.form.reset();
    this.store.dispatch(new ClearMessages());
  }
}
