import { Component, OnInit, Input, Output, EventEmitter } from '@angular/core';
import { Tag } from '../../models/tag';
import { Select, Store } from '@ngxs/store';
import { ProjectTagState, ClearMessages } from '../../stores/project-tag.state';
import { Observable } from 'rxjs';
import { NgbModalRef, NgbModal } from '@ng-bootstrap/ng-bootstrap';

@Component({
  selector: 'app-assigned-tags',
  templateUrl: './assigned-tags.component.html',
  styleUrls: ['./assigned-tags.component.css'],
})
export class AssignedTagsComponent implements OnInit {
  @Input()
  hint: string = '';

  @Input()
  tags: Tag[];

  @Input()
  availableTags: Tag[];

  @Output()
  add = new EventEmitter<Tag>();

  @Output()
  remove = new EventEmitter<Tag>();

  @Select(ProjectTagState.errorMessage)
  errorMessage$: Observable<string | undefined>;

  @Select(ProjectTagState.isLoading)
  isLoading$: Observable<boolean>;

  modal: NgbModalRef | undefined;

  selectedTag: Tag | undefined;

  constructor(private modalService: NgbModal, private store: Store) {}

  ngOnInit() {}

  ngOnDestroy() {}

  open(content) {
    this.modal = this.modalService.open(content);
    this.modal.result.then(() => this.reset(), () => this.reset());
  }

  confirmSelection() {
    this.add.emit(this.selectedTag);
    this.modal.close();
  }

  isValid() {
    return !!this.selectedTag;
  }

  reset() {
    this.selectedTag = undefined;
  }
}
