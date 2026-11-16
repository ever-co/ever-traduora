import { NO_ERRORS_SCHEMA } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Label } from '../../../projects/models/label';
import { SelectLabelComponent } from './select-label.component';

describe('SelectLabelComponent', () => {
  const label = (id: string, value: string): Label => {
    const l = new Label();
    l.id = id;
    l.value = value;
    l.color = '#304D6D';
    return l;
  };

  const labels: Label[] = [label('l1', 'Billing'), label('l2', 'Onboarding')];

  const render = (): ComponentFixture<SelectLabelComponent> => {
    TestBed.configureTestingModule({ declarations: [SelectLabelComponent], schemas: [NO_ERRORS_SCHEMA] });
    const fixture = TestBed.createComponent(SelectLabelComponent);
    fixture.componentInstance.labels = labels;
    fixture.detectChanges();
    return fixture;
  };

  const options = (fixture: ComponentFixture<SelectLabelComponent>): HTMLElement[] =>
    Array.from(fixture.nativeElement.querySelectorAll('.list-group-item-action'));

  it('renders each label as a button that the keyboard can reach', () => {
    const items = options(render());

    expect(items.length).toBe(2);
    for (const item of items) {
      expect(item.tagName).toBe('BUTTON');
      expect(item.getAttribute('type')).toBe('button');
      expect(item.tabIndex).toBeGreaterThanOrEqual(0);
    }
  });

  it('emits the chosen label and marks only its option as pressed', () => {
    const fixture = render();
    const emitted: Label[] = [];
    fixture.componentInstance.selectLabel.subscribe((l: Label) => emitted.push(l));

    options(fixture)[1].click();
    fixture.detectChanges();

    expect(emitted).toEqual([labels[1]]);
    const [first, second] = options(fixture);
    expect(second.getAttribute('aria-pressed')).toBe('true');
    expect(first.getAttribute('aria-pressed')).toBe('false');
  });

  it('names the search input', () => {
    const input: HTMLInputElement = render().nativeElement.querySelector('input#labelsSearch');

    expect(input.getAttribute('aria-label')).toBe('Search labels');
  });
});
