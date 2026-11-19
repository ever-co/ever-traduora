import { TestBed } from '@angular/core/testing';
import { ErrorMessageComponent } from './error-message.component';

describe('ErrorMessageComponent', () => {
  const message = 'Could not save the translation, please try again.';

  // The text a screen reader reads: subtrees marked aria-hidden are left out.
  const spokenText = (node: Node): string => {
    if (node instanceof Element && node.getAttribute('aria-hidden') === 'true') {
      return '';
    }
    return node.nodeType === Node.TEXT_NODE ? node.textContent : Array.from(node.childNodes, spokenText).join('');
  };

  const render = (): HTMLElement => {
    TestBed.configureTestingModule({ declarations: [ErrorMessageComponent] });
    const fixture = TestBed.createComponent(ErrorMessageComponent);
    fixture.componentInstance.message = message;
    fixture.detectChanges();
    return fixture.nativeElement.querySelector('.alert');
  };

  it('marks the banner as an alert, so screen readers announce it when it appears', () => {
    const banner = render();

    expect(banner.getAttribute('role')).toBe('alert');
    expect(banner.textContent).toContain(message);
  });

  it('hides the warning icon from screen readers, so only the message is read', () => {
    const banner = render();
    const icon: HTMLElement = banner.querySelector('i.material-icons');

    expect(icon.textContent.trim()).toBe('warning');
    expect(icon.getAttribute('aria-hidden')).toBe('true');
    expect(spokenText(banner).trim()).toBe(message);
  });
});
