import { Component, ElementRef, EventEmitter, Input, OnChanges, OnInit, Output, ViewChild } from '@angular/core';
import { hexToHSL } from '../../util/color-utils';
import * as _ from 'lodash';
import { Label } from '../../../projects/models/label';

@Component({
  selector: 'app-editable-label',
  templateUrl: './editable-label.component.html',
  styleUrls: ['./editable-label.component.css'],
})
export class EditableLabelComponent implements OnInit, OnChanges {
  @Input()
  readOnly = false;

  @Input()
  label: Label;

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
  save = new EventEmitter<Label>();

  @Output()
  remove = new EventEmitter<Label>();

  @ViewChild('focusTarget')
  focusTarget: ElementRef;

  isEditing = false;

  editedValue = '';
  editedBackgroundColor = '';

  constructor() {}

  ngOnInit() {}

  ngOnChanges() {
    if (!this.isEditing) {
      this.editedValue = this.label.value;
      this.editedBackgroundColor = this.label.color;
    }
  }

  enterEdit() {
    if (!this.isEditing) {
      this.editedValue = this.label.value;
      this.editedBackgroundColor = this.label.color;
      this.isEditing = true;
      this.focus();
    }
  }

  exitEdit() {
    this.isEditing = false;
    this.focusTarget.nativeElement.blur();
  }

  revert() {
    this.editedValue = this.label.value;
    this.editedBackgroundColor = this.label.color;
    this.exitEdit();
  }

  randomColor() {
    this.editedBackgroundColor = _.sample(this.availableColors);
  }

  onSave() {
    if (this.valid()) {
      this.save.emit({ id: this.label.id, value: this.editedValue, color: this.editedBackgroundColor });
      this.exitEdit();
    }
  }

  onRemove() {
    this.remove.emit(this.label);
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
