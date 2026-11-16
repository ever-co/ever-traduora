import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Label } from '../../../projects/models/label';
import { LabelComponent } from './label.component';

describe('LabelComponent', () => {
  const render = (removable: boolean): ComponentFixture<LabelComponent> => {
    TestBed.configureTestingModule({ declarations: [LabelComponent] });
    const fixture = TestBed.createComponent(LabelComponent);
    const label = new Label();
    label.id = 'l1';
    label.value = 'Billing';
    label.color = '#304D6D';
    fixture.componentInstance.label = label;
    fixture.componentInstance.removable = removable;
    fixture.detectChanges();
    return fixture;
  };

  it('names the remove button after the label and hides its icon from assistive tech', () => {
    const fixture = render(true);
    const button: HTMLButtonElement = fixture.nativeElement.querySelector('button');

    expect(button).not.toBeNull();
    expect(button.getAttribute('type')).toBe('button');
    expect(button.getAttribute('aria-label')).toContain('Billing');
    expect(button.querySelector('i.material-icons').getAttribute('aria-hidden')).toBe('true');
  });

  it('emits the label when the remove button is clicked', () => {
    const fixture = render(true);
    const emitted: Label[] = [];
    fixture.componentInstance.remove.subscribe((l: Label) => emitted.push(l));

    fixture.nativeElement.querySelector('button').click();

    expect(emitted).toEqual([fixture.componentInstance.label]);
  });

  it('renders no remove button when the label is not removable', () => {
    const fixture = render(false);

    expect(fixture.nativeElement.querySelector('button')).toBeNull();
  });
});
