import { Component, ElementRef, EventEmitter, Input, OnChanges, Output, SimpleChanges, ViewChild } from '@angular/core';

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

  /**
   * Where Save writes the text, e.g. the locale of a translation. The page can keep this field and show another
   * locale in it: an edit started for the previous one is then dropped, so its text is never saved to the new one.
   */
  @Input()
  saveTarget: string | undefined;

  @Output()
  save = new EventEmitter<string>();

  @ViewChild('focusTarget', { static: true })
  focusTarget: ElementRef;

  isEditing = false;

  current = '';

  /** The user typed in the field since the edit started: a new bound value must not replace that text. */
  private dirty = false;

  ngOnChanges(changes: SimpleChanges) {
    if (changes.saveTarget && !changes.saveTarget.firstChange && this.isEditing) {
      // The field now saves to another locale: drop the text typed for the previous one and leave the edit. Not with
      // exitEdit(), which would pull the focus back from wherever the new locale was picked.
      this.isEditing = false;
      this.dirty = false;
    }
    // A field that was only focused (Tab or a click, nothing typed) takes a new bound value, e.g. once the page
    // shows another locale; a text the user typed is kept until Save or Revert, as long as Save still writes it to the
    // same place
    if (!this.isEditing || !this.dirty) {
      // A term created without a context has a null value
      this.current = this.value ?? '';
    }
  }

  /** The field got the focus (Tab or a click): show Save and Revert. It already has the focus, so none is scheduled. */
  onFocus() {
    if (!this.readOnly && !this.isEditing) {
      this.current = this.value ?? '';
      this.isEditing = true;
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
    this.dirty = true;
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
    this.dirty = false;
  }

  revert() {
    this.current = this.value ?? '';
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
