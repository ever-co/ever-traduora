import { Component, ElementRef, EventEmitter, Input, OnChanges, Output, ViewChild } from '@angular/core';

@Component({
  standalone: false,
  selector: 'app-editable-text',
  templateUrl: './editable-text.component.html',
  styleUrls: ['./editable-text.component.css'],
})
export class EditableTextComponent implements OnChanges {
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

  ngOnChanges() {
    if (!this.isEditing) {
      // A term created without a context has a null value
      this.current = this.value ?? '';
    }
  }

  enterEdit() {
    if (!this.isEditing) {
      this.current = this.value ?? '';
      this.isEditing = true;
      this.focus();
    }
  }

  onInput(text: string) {
    this.current = text;
    // The field keeps the focus after a save or a revert: typing in it again starts a new edit, with the typed text
    if (!this.readOnly && !this.isEditing) {
      this.isEditing = true;
    }
  }

  exitEdit() {
    // Keep the focus in the field, or keyboard and screen reader users are sent back to the top of the page.
    // A click on Save or Revert moved it to that button, which goes away with the edit controls: give it back to the
    // field while still editing, so that this focus does not start a new edit.
    this.focusTarget.nativeElement.focus();
    this.isEditing = false;
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
