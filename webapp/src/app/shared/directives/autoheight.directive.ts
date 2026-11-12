import { AfterViewChecked, Directive, ElementRef, HostListener, Input, OnDestroy } from '@angular/core';

@Directive({
  standalone: false,
  selector: 'textarea[appAutoheight]',
})
export class AutoheightDirective implements AfterViewChecked, OnDestroy {
  @Input()
  maxHeight = 500;

  private lastValue: string;
  private lastWidth: number;

  // The text wraps differently when the textarea gets narrower or wider,
  // e.g. once the elements next to it are rendered, so the height has to follow the width too
  private resizeObserver = new ResizeObserver(entries => {
    const width = entries[0].contentRect.width;
    if (width === this.lastWidth) {
      return;
    }
    this.lastWidth = width;
    // Changing the height inside the observer callback would trigger another
    // resize in the same frame, so wait for the next one
    requestAnimationFrame(() => this.updateHeight());
  });

  constructor(private elem: ElementRef) {
    const textarea = this.elem.nativeElement as HTMLTextAreaElement;
    textarea.rows = 1;
    textarea.style.overflow = 'hidden';
    this.lastValue = textarea.value;
    this.resizeObserver.observe(textarea);
  }

  ngAfterViewChecked() {
    this.resize();
  }

  ngOnDestroy() {
    this.resizeObserver.disconnect();
  }

  @HostListener('input')
  resize() {
    const textarea = this.elem.nativeElement as HTMLTextAreaElement;
    if (textarea.value === this.lastValue) {
      return;
    }
    this.lastValue = textarea.value;
    this.updateHeight();
  }

  private updateHeight() {
    const textarea = this.elem.nativeElement as HTMLTextAreaElement;
    // Reset textarea height to auto that correctly calculate the new height
    textarea.style.height = 'auto';
    // Set new height
    textarea.style.height = `${textarea.scrollHeight}px`;
  }
}
