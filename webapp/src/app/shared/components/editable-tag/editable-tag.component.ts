import { Component, ElementRef, EventEmitter, Input, OnChanges, OnInit, Output, ViewChild } from '@angular/core';
import { hexToHSL } from './../../util/color-utils';
import * as _ from 'lodash';
import { Tag } from '../../../projects/models/tag';

@Component({
  selector: 'app-editable-tag',
  templateUrl: './editable-tag.component.html',
  styleUrls: ['./editable-tag.component.css'],
})
export class EditableTagComponent implements OnInit, OnChanges {
  @Input()
  readOnly = false;

  @Input()
  tag: Tag;

  @Input()
  placeholder = '';

  @Input()
  allowEmpty = false;

  @Input()
  removable = false;

  @Input()
  availableColors: string[] = [];

  get textColor(): string {
    const hsl = hexToHSL(this.editedBackgroundColor);
    if (hsl.luminance >= 50) return '#202020';
    else return '#f0f0f0';
  }

  @Output()
  save = new EventEmitter<Tag>();

  @Output()
  remove = new EventEmitter<Tag>();

  @ViewChild('focusTarget')
  focusTarget: ElementRef;

  isEditing = false;

  editedValue = '';
  editedBackgroundColor = '';

  constructor() {}

  ngOnInit() {}

  ngOnChanges() {
    if (!this.isEditing) {
      this.editedValue = this.tag.value;
      this.editedBackgroundColor = this.tag.color;
    }
  }

  enterEdit() {
    if (!this.isEditing) {
      this.editedValue = this.tag.value;
      this.editedBackgroundColor = this.tag.color;
      this.isEditing = true;
      this.focus();
    }
  }

  exitEdit() {
    this.isEditing = false;
    this.focusTarget.nativeElement.blur();
  }

  revert() {
    this.editedValue = this.tag.value;
    this.editedBackgroundColor = this.tag.color;
    this.exitEdit();
  }

  randomColor() {
    this.editedBackgroundColor = _.sample(this.availableColors);
  }

  onSave() {
    if (this.valid()) {
      this.save.emit({ id: this.tag.id, value: this.editedValue, color: this.editedBackgroundColor });
      this.exitEdit();
    }
  }

  onRemove() {
    this.remove.emit(this.tag);
    this.exitEdit();
  }

  valid() {
    if (this.allowEmpty) {
      return true;
    }
    return this.editedValue && this.editedValue.length > 0;
  }

  focus() {
    setTimeout(() => {
      this.focusTarget.nativeElement.focus();
    }, 16);
  }
}
