import { Component, ElementRef, EventEmitter, Input, OnChanges, OnInit, Output, ViewChild } from '@angular/core';

@Component({
  selector: 'app-editable-text',
  templateUrl: './editable-text.component.html',
  styleUrls: ['./editable-text.component.css'],
})
export class EditableTextComponent implements OnInit, OnChanges {
  @Input()
  readOnly = false;

  @Input()
  showLength = false;

  @Input()
  value = '';

  @Input()
  placeholder = '';

  @Input()
  allowEmpty = true;

  @Output()
  save = new EventEmitter<string>();

  @ViewChild('focusTarget', { static: true })
  focusTarget: ElementRef;

  isEditing = false;

  current = '';

  constructor() {}

  ngOnInit() {}

  ngOnChanges() {
    if (!this.isEditing) {
      this.current = this.value;
    }
  }

  enterEdit() {
    if (!this.isEditing) {
      this.current = this.value;
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
    this.exitEdit();
  }

  onSave() {
    if (this.valid()) {
      this.save.emit(this.current);
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
