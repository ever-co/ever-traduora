import { Injectable } from '@angular/core';

@Injectable({
  providedIn: 'root',
})
export class ClipboardService {
  /**
   * Copies text to the clipboard. Resolves to true on success, false otherwise.
   * Uses the async Clipboard API when available and falls back to execCommand.
   */
  async copy(text: string): Promise<boolean> {
    if (typeof text !== 'string') {
      return false;
    }
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch {
      // Fall through to the legacy path (e.g. permission denied).
    }
    return this.legacyCopy(text);
  }

  private legacyCopy(text: string): boolean {
    // Selecting the textarea moves focus to it: give focus back afterwards, or keyboard users lose their place
    const previousFocus = document.activeElement as HTMLElement | null;
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', '');
    textarea.setAttribute('aria-hidden', 'true');
    textarea.style.position = 'fixed';
    textarea.style.top = '0';
    textarea.style.left = '-9999px';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    try {
      textarea.select();
      // iOS Safari ignores select() on a read-only textarea
      textarea.setSelectionRange(0, text.length);
      return document.execCommand('copy');
    } catch {
      return false;
    } finally {
      document.body.removeChild(textarea);
      if (previousFocus && previousFocus !== document.body && typeof previousFocus.focus === 'function') {
        previousFocus.focus();
      }
    }
  }
}
