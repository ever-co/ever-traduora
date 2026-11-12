import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { AutoheightDirective } from './autoheight.directive';

@Component({
  standalone: false,
  template: `
    <div [style.width.px]="width">
      <textarea appAutoheight [value]="value" style="width: 100%; box-sizing: border-box"></textarea>
    </div>
  `,
})
class HostComponent {
  width = 800;
  value = 'A long reference text that wraps onto more lines once the textarea gets narrower. '.repeat(20);
}

describe('AutoheightDirective', () => {
  let fixture: ComponentFixture<HostComponent>;
  let textarea: HTMLTextAreaElement;

  beforeEach(() => {
    TestBed.configureTestingModule({
      declarations: [HostComponent, AutoheightDirective],
    });
    fixture = TestBed.createComponent(HostComponent);
    document.body.appendChild(fixture.nativeElement);
    fixture.detectChanges();
    textarea = fixture.nativeElement.querySelector('textarea');
  });

  afterEach(() => {
    fixture.destroy();
    fixture.nativeElement.remove();
  });

  it('should show the whole value', () => {
    expect(textarea.offsetHeight).toBeGreaterThanOrEqual(textarea.scrollHeight);
  });

  it('should grow when the textarea gets narrower', async () => {
    const initialHeight = textarea.offsetHeight;

    fixture.componentInstance.width = 400;
    fixture.detectChanges();
    // the observer fires after layout and the height is set on the frame after that
    await waitForFrames(3);

    expect(textarea.offsetHeight).toBeGreaterThan(initialHeight);
    expect(textarea.offsetHeight).toBeGreaterThanOrEqual(textarea.scrollHeight);
  });
});

async function waitForFrames(count: number) {
  for (let i = 0; i < count; i++) {
    await new Promise(resolve => requestAnimationFrame(resolve));
  }
}
