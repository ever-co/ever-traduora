import { Component, OnInit, Input, Output, EventEmitter } from '@angular/core';
import { Label } from '../../models/label';
import { Select, Store } from '@ngxs/store';
import { ProjectLabelState, ClearMessages } from '../../stores/project-label.state';
import { Observable } from 'rxjs';
import { NgbModalRef, NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { Project } from '../../models/project';
import { ProjectsState } from '../../stores/projects.state';

@Component({
  selector: 'app-assigned-labels',
  templateUrl: './assigned-labels.component.html',
  styleUrls: ['./assigned-labels.component.css'],
})
export class AssignedLabelsComponent implements OnInit {
  @Select(ProjectsState.currentProject)
  project$: Observable<Project | undefined>;

  @Input()
  hint = '';

  @Input()
  labels: Label[];

  @Input()
  availableLabels: Label[];

  @Output()
  add = new EventEmitter<Label>();

  @Output()
  remove = new EventEmitter<Label>();

  @Input()
  editable = true;

  @Select(ProjectLabelState.errorMessage)
  errorMessage$: Observable<string | undefined>;

  @Select(ProjectLabelState.isLoading)
  isLoading$: Observable<boolean>;

  modal: NgbModalRef | undefined;

  selectedLabel: Label | undefined;

  constructor(private modalService: NgbModal, private store: Store) {}

  ngOnInit() {}

  open(content) {
    this.modal = this.modalService.open(content);
    this.modal.result.then(
      () => this.reset(),
      () => this.reset(),
    );
  }

  confirmSelection() {
    this.add.emit(this.selectedLabel);
    this.modal.close();
  }

  isValid() {
    return !!this.selectedLabel;
  }

  reset() {
    this.selectedLabel = undefined;
  }
}
