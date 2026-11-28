import { TestBed } from '@angular/core/testing';
import { ClipboardService } from './clipboard.service';

describe('ClipboardService', () => {
  let service: ClipboardService;
  const originalClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard');

  const setClipboard = (value: unknown) => Object.defineProperty(navigator, 'clipboard', { value, configurable: true });

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(ClipboardService);
  });

  afterEach(() => {
    if (originalClipboard) {
      Object.defineProperty(navigator, 'clipboard', originalClipboard);
    } else {
      delete (navigator as any).clipboard;
    }
  });

  it('writes the text with the async clipboard API', async () => {
    const writeText = jasmine.createSpy('writeText').and.returnValue(Promise.resolve());
    setClipboard({ writeText });

    expect(await service.copy('Hello')).toBeTrue();
    expect(writeText).toHaveBeenCalledWith('Hello');
  });

  it('copies empty strings as-is', async () => {
    const writeText = jasmine.createSpy('writeText').and.returnValue(Promise.resolve());
    setClipboard({ writeText });

    expect(await service.copy('')).toBeTrue();
    expect(writeText).toHaveBeenCalledWith('');
  });

  it('falls back to execCommand when the async API rejects', async () => {
    setClipboard({ writeText: () => Promise.reject(new Error('denied')) });
    const exec = spyOn(document, 'execCommand').and.returnValue(true);
    // Component specs leave their fixtures in the page (test.ts keeps them after each test), e.g. a read-only textarea
    const leftover = document.createElement('textarea');
    leftover.setAttribute('readonly', '');
    document.body.appendChild(leftover);
    const textareas = document.querySelectorAll('textarea[readonly]').length;

    try {
      expect(await service.copy('Hello')).toBeTrue();
      expect(exec).toHaveBeenCalledWith('copy');
      // Only the textarea of the copy is gone: compare with the page as it was, not with an empty page
      expect(document.querySelectorAll('textarea[readonly]').length).toBe(textareas);
    } finally {
      leftover.remove();
    }
  });

  it('reports failure when no copy method works', async () => {
    setClipboard(undefined);
    spyOn(document, 'execCommand').and.returnValue(false);

    expect(await service.copy('Hello')).toBeFalse();
  });

  it('uses the fallback when the async API is missing, as on plain HTTP', async () => {
    setClipboard(undefined);
    const exec = spyOn(document, 'execCommand').and.returnValue(true);

    expect(await service.copy('Hello')).toBeTrue();
    expect(exec).toHaveBeenCalledWith('copy');
  });

  it('removes the fallback textarea and reports failure when execCommand throws', async () => {
    setClipboard(undefined);
    spyOn(document, 'execCommand').and.throwError('blocked');
    const textareas = document.querySelectorAll('textarea').length;

    expect(await service.copy('Hello')).toBeFalse();
    expect(document.querySelectorAll('textarea').length).toBe(textareas);
  });

  it('selects the whole text for the fallback and gives focus back to the copy button', async () => {
    const button = document.createElement('button');
    document.body.appendChild(button);
    button.focus();
    setClipboard(undefined);
    let selected = '';
    spyOn(document, 'execCommand').and.callFake(() => {
      const textarea = document.activeElement as HTMLTextAreaElement;
      selected = textarea.value.substring(textarea.selectionStart, textarea.selectionEnd);
      return true;
    });

    try {
      expect(await service.copy('Hello world')).toBeTrue();
      expect(selected).toBe('Hello world');
      expect(document.activeElement).toBe(button);
    } finally {
      button.remove();
    }
  });

  it('rejects non-string input without touching the clipboard', async () => {
    const writeText = jasmine.createSpy('writeText').and.returnValue(Promise.resolve());
    setClipboard({ writeText });

    expect(await service.copy(undefined as any)).toBeFalse();
    expect(writeText).not.toHaveBeenCalled();
  });
});
