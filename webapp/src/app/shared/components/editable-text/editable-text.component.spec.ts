import { ComponentFixture, TestBed, fakeAsync, flush, tick } from '@angular/core/testing';
import { EditableTextComponent } from './editable-text.component';

describe('EditableTextComponent', () => {
  let fixture: ComponentFixture<EditableTextComponent>;
  let component: EditableTextComponent;
  let textarea: HTMLTextAreaElement;
  let saved: string[];

  const saveButton = (): HTMLButtonElement => fixture.nativeElement.querySelector('button[aria-label="Save"]');
  const revertButton = (): HTMLButtonElement => fixture.nativeElement.querySelector('button[aria-label="Revert changes"]');

  const type = (text: string) => {
    textarea.value = text;
    textarea.dispatchEvent(new Event('input'));
    fixture.detectChanges();
  };

  beforeEach(() => {
    TestBed.configureTestingModule({ declarations: [EditableTextComponent] });
    fixture = TestBed.createComponent(EditableTextComponent);
    component = fixture.componentInstance;
    saved = [];
    component.save.subscribe((text: string) => saved.push(text));
    fixture.componentRef.setInput('value', 'Hello');
    fixture.componentRef.setInput('showLength', true);
    fixture.detectChanges();
    textarea = fixture.nativeElement.querySelector('textarea');
  });

  afterEach(() => {
    // The component stays in the page after each test: do not leave the focus in it
    textarea.blur();
  });

  it('shows Save and Revert when the field gets the focus from the keyboard, not only on a click', fakeAsync(() => {
    textarea.dispatchEvent(new Event('focus'));
    fixture.detectChanges();
    flush();

    expect(saveButton()).not.toBeNull();
    expect(revertButton()).not.toBeNull();
  }));

  it('does not enter edit mode on focus when the field is read only', fakeAsync(() => {
    fixture.componentRef.setInput('readOnly', true);
    fixture.detectChanges();

    textarea.dispatchEvent(new Event('focus'));
    fixture.detectChanges();
    flush();

    expect(component.isEditing).toBeFalse();
    expect(saveButton()).toBeNull();
  }));

  it('does not pull the focus back to the field when it leaves right after getting it', fakeAsync(() => {
    const other = document.createElement('button');
    document.body.appendChild(other);
    try {
      textarea.focus();
      fixture.detectChanges();
      other.focus();
      tick(50);

      expect(document.activeElement).toBe(other);
    } finally {
      other.remove();
    }
  }));

  it('takes a new value from the page when the user only tabbed through the field, e.g. after a switch to another locale', fakeAsync(() => {
    textarea.focus();
    fixture.detectChanges();
    flush();
    expect(saveButton()).not.toBeNull();

    // The same field now shows the term in another locale
    fixture.componentRef.setInput('value', 'Hallo');
    fixture.detectChanges();
    textarea.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', ctrlKey: true }));
    fixture.detectChanges();
    flush();

    expect(saved).toEqual(['Hallo']);
    expect(textarea.value).toBe('Hallo');
  }));

  it('keeps the text the user typed when the page gives a new value before Save or Revert', fakeAsync(() => {
    textarea.focus();
    fixture.detectChanges();
    flush();
    type('Hello world');

    fixture.componentRef.setInput('value', 'Hallo');
    fixture.detectChanges();

    expect(textarea.value).toBe('Hello world');
    revertButton().click();
    fixture.detectChanges();
    flush();
    expect(textarea.value).toBe('Hallo');
  }));

  it('keeps the focus in the field after a save with Ctrl+Enter', fakeAsync(() => {
    textarea.focus();
    textarea.click();
    fixture.detectChanges();
    flush();
    type('Hello world');

    textarea.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', ctrlKey: true }));
    fixture.detectChanges();
    flush();

    expect(saved).toEqual(['Hello world']);
    expect(saveButton()).toBeNull();
    expect(document.activeElement).toBe(textarea);
  }));

  it('gives the focus back to the field after a click on Save, without starting a new edit', fakeAsync(() => {
    textarea.focus();
    textarea.click();
    fixture.detectChanges();
    flush();
    type('Hello world');

    // A click on a button moves the focus to it
    saveButton().focus();
    saveButton().click();
    fixture.detectChanges();
    flush();

    expect(saved).toEqual(['Hello world']);
    expect(document.activeElement).toBe(textarea);
    expect(saveButton()).toBeNull();
    expect(textarea.value).toBe('Hello world');
  }));

  it('gives the focus back to the field after a click on Revert, with the saved text', fakeAsync(() => {
    textarea.focus();
    textarea.click();
    fixture.detectChanges();
    flush();
    type('Hello world');

    revertButton().focus();
    revertButton().click();
    fixture.detectChanges();
    flush();

    expect(saved).toEqual([]);
    expect(document.activeElement).toBe(textarea);
    expect(saveButton()).toBeNull();
    expect(textarea.value).toBe('Hello');
  }));

  it('shows Save and Revert again, and keeps the text, when the user types in the field after a save', fakeAsync(() => {
    textarea.focus();
    textarea.click();
    fixture.detectChanges();
    flush();
    type('Hello world');
    textarea.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', ctrlKey: true }));
    fixture.detectChanges();
    flush();

    // Typing alone, with no click, starts the new edit
    type('Hello world!');

    expect(saveButton()).not.toBeNull();
    expect(revertButton()).not.toBeNull();
    expect(textarea.value).toBe('Hello world!');
    saveButton().click();
    expect(saved).toEqual(['Hello world', 'Hello world!']);
  }));

  it('shows a length of 0 for a field without a value, such as the context of a term created without one', fakeAsync(() => {
    fixture.componentRef.setInput('value', null);
    fixture.detectChanges();

    textarea.click();
    expect(() => fixture.detectChanges()).not.toThrow();
    flush();

    expect(saveButton()).not.toBeNull();
    expect(fixture.nativeElement.querySelector('.edit-controls small').textContent.trim()).toBe('0');
    expect(textarea.value).toBe('');
  }));
});
