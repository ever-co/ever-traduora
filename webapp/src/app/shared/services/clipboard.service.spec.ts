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

    expect(await service.copy('Hello')).toBeTrue();
    expect(exec).toHaveBeenCalledWith('copy');
    expect(document.querySelectorAll('textarea[readonly]').length).toBe(0);
  });

  it('reports failure when no copy method works', async () => {
    setClipboard(undefined);
    spyOn(document, 'execCommand').and.returnValue(false);

    expect(await service.copy('Hello')).toBeFalse();
  });

  it('rejects non-string input without touching the clipboard', async () => {
    const writeText = jasmine.createSpy('writeText').and.returnValue(Promise.resolve());
    setClipboard({ writeText });

    expect(await service.copy(undefined as any)).toBeFalse();
    expect(writeText).not.toHaveBeenCalled();
  });
});
