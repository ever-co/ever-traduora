import { Component, ElementRef, EventEmitter, Input, OnChanges, OnInit, Output, ViewChild } from '@angular/core';
import { hexToHSL } from './../../util/color-utils';
import * as _ from 'lodash';

@Component({
  selector: 'app-editable-tag',
  templateUrl: './editable-tag.component.html',
  styleUrls: ['./editable-tag.component.css'],
})
export class EditableTagComponent implements OnInit, OnChanges {
  @Input()
  readOnly = false;

  @Input()
  value = '';

  @Input()
  placeholder = '';

  @Input()
  allowEmpty = false;

  @Input()
  backgroundColor = '#008C45';

  @Input()
  availableColors: string[] = [];

  get textColor(): string {
    const hsl = hexToHSL(this.currentBackgroundColor);
    if (hsl.luminance >= 50) return '#202020';
    else return '#dfdfdf';
  }

  @Output()
  save = new EventEmitter<{ value: string; color: string }>();

  @ViewChild('focusTarget')
  focusTarget: ElementRef;

  isEditing = false;

  current = '';
  currentBackgroundColor = '';

  constructor() {}

  ngOnInit() {}

  ngOnChanges() {
    if (!this.isEditing) {
      this.current = this.value;
      this.currentBackgroundColor = this.backgroundColor;
    }
  }

  enterEdit() {
    if (!this.isEditing) {
      this.current = this.value;
      this.currentBackgroundColor = this.backgroundColor;
      this.isEditing = true;
      this.focus();
    }
  }

  exitEdit() {
    this.isEditing = false;
    this.focusTarget.nativeElement.blur();
  }

  revert() {
    this.current = this.value;
    this.currentBackgroundColor = this.backgroundColor;
    this.exitEdit();
  }

  randomColor() {
    this.currentBackgroundColor = _.sample(this.availableColors);
  }

  onSave() {
    if (this.valid()) {
      this.save.emit({ value: this.current, color: this.currentBackgroundColor });
      this.exitEdit();
    }
  }

  valid() {
    if (this.allowEmpty) {
      return true;
    }
    return this.current && this.current.length > 0;
  }

  focus() {
    setTimeout(() => {
      this.focusTarget.nativeElement.focus();
    }, 16);
  }
}
