import { AfterViewChecked, Directive, ElementRef, HostListener, Input } from '@angular/core';

@Directive({
  selector: 'textarea[appAutosize]',
})
export class AutosizeDirective implements AfterViewChecked {
  @Input()
  maxHeight = 500;

  private lastValue: string;

  constructor(private elem: ElementRef) {
    const textarea = this.elem.nativeElement as HTMLTextAreaElement;
    textarea.rows = 1;
    textarea.style.overflow = 'hidden';
    this.lastValue = textarea.value;
  }

  ngAfterViewChecked() {
    this.resize();
  }

  @HostListener('input')
  resize() {
    const textarea = this.elem.nativeElement as HTMLTextAreaElement;
    if (textarea.value === this.lastValue) {
      return;
    }
    this.lastValue = textarea.value;
    // Reset textarea height to auto that correctly calculate the new height
    textarea.style.height = 'auto';
    // Set new height
    textarea.style.height = `${textarea.scrollHeight}px`;
  }
}
