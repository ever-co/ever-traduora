import { AfterViewChecked, Directive, ElementRef, HostListener, Input } from '@angular/core';

@Directive({
  selector: 'textarea[appAutowidth]',
})
export class AutowidthDirective implements AfterViewChecked {
  @Input()
  minLength = 8;

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
    textarea.style.width = 'auto';
    textarea.cols = Math.max(textarea.textLength, this.minLength);
  }
}
