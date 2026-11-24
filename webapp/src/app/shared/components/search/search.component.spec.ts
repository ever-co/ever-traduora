import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { NgbPaginationModule } from '@ng-bootstrap/ng-bootstrap';
import { of } from 'rxjs';
import { SearchComponent } from './search.component';

describe('SearchComponent', () => {
  let fixture: ComponentFixture<SearchComponent>;

  // The text a screen reader reads: subtrees marked aria-hidden are left out.
  const spokenText = (node: Node): string => {
    if (node instanceof Element && node.getAttribute('aria-hidden') === 'true') {
      return '';
    }
    return node.nodeType === Node.TEXT_NODE ? node.textContent : Array.from(node.childNodes, spokenText).join('');
  };

  const render = (placeholder?: string) => {
    TestBed.configureTestingModule({ imports: [NgbPaginationModule], declarations: [SearchComponent] });
    fixture = TestBed.createComponent(SearchComponent);
    const component = fixture.componentInstance;
    component.items = of([{ name: 'greeting' }, { name: 'farewell' }]);
    component.key = item => item.name;
    component.trackBy = item => item.name;
    if (placeholder !== undefined) {
      component.placeholder = placeholder;
    }
    fixture.detectChanges();
    // The search box debounces its results
    tick(50);
    fixture.detectChanges();
  };

  const field = (): HTMLInputElement => fixture.nativeElement.querySelector('input');
  const liveRegion = (): HTMLElement => fixture.nativeElement.querySelector('[aria-live]');

  const search = (text: string) => {
    field().value = text;
    field().dispatchEvent(new Event('input'));
    fixture.detectChanges();
    tick(50);
    fixture.detectChanges();
  };

  it('names the search field after its placeholder', fakeAsync(() => {
    render();
    expect(field().getAttribute('aria-label')).toBe('Search...');
    fixture.destroy();

    TestBed.resetTestingModule();
    render('Search terms');
    expect(field().getAttribute('placeholder')).toBe('Search terms');
    expect(field().getAttribute('aria-label')).toBe('Search terms');
    fixture.destroy();
  }));

  it('hides the search icon from assistive tech', fakeAsync(() => {
    render();
    const icon: HTMLElement = fixture.nativeElement.querySelector('.input-group-text i.material-icons');

    expect(icon.textContent.trim()).toBe('search');
    expect(icon.getAttribute('aria-hidden')).toBe('true');
    fixture.destroy();
  }));

  it('has the live region in the page, empty, before anything is searched', fakeAsync(() => {
    render();
    const region = liveRegion();

    expect(region).not.toBeNull();
    expect(region.getAttribute('aria-live')).toBe('polite');
    expect(region.getAttribute('aria-atomic')).toBe('true');
    expect(region.textContent.trim()).toBe('');
    fixture.destroy();
  }));

  it('adds the no-results notice into the live region that was already there, without its icon text', fakeAsync(() => {
    render();
    const region = liveRegion();

    search('nothing-matches');

    expect(liveRegion()).toBe(region);
    expect(region.querySelector('i.material-icons').getAttribute('aria-hidden')).toBe('true');
    expect(spokenText(region).trim()).toBe('Your search yielded no results...');
    fixture.destroy();
  }));

  it('empties the live region again when the search matches, and keeps it in the page', fakeAsync(() => {
    render();
    const region = liveRegion();

    search('nothing-matches');
    search('greet');

    expect(liveRegion()).toBe(region);
    expect(region.textContent.trim()).toBe('');
    fixture.destroy();
  }));
});
