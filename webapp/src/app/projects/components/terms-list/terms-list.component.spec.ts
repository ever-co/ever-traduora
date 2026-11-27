import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { NO_ERRORS_SCHEMA, Pipe, PipeTransform } from '@angular/core';
import { ComponentFixture, fakeAsync, TestBed, tick } from '@angular/core/testing';
import { ReactiveFormsModule } from '@angular/forms';
import { NgbPaginationModule } from '@ng-bootstrap/ng-bootstrap';
import { NgxsModule } from '@ngxs/store';
import { of, Subscription } from 'rxjs';
import { environment } from '../../../../environments/environment';
import { SearchComponent } from '../../../shared/components/search/search.component';
import { Label } from '../../models/label';
import { Term } from '../../models/term';
import { ProjectLabelState } from '../../stores/project-label.state';
import { TermsState } from '../../stores/terms.state';
import { TermsListComponent } from './terms-list.component';

@Pipe({ name: 'can' })
class AllowAllPipe implements PipeTransform {
  transform() {
    return of(true);
  }
}

describe('TermsListComponent label filter', () => {
  const projectUrl = `${environment.apiEndpoint}/projects/p1`;
  const labelA: Label = { id: 'la', value: 'A', color: '#304D6D' };
  const labelB: Label = { id: 'lb', value: 'B', color: '#A7CCED' };
  const terms: Term[] = [
    { id: 't1', value: 'term.both', context: null, labels: [labelA, labelB] },
    { id: 't2', value: 'term.only-b', context: null, labels: [labelB] },
    { id: 't3', value: 'term.unlabelled', context: null, labels: [] },
  ];

  let fixture: ComponentFixture<TermsListComponent>;
  let http: HttpTestingController;
  let sub: Subscription;
  let shown: Term[];

  // Answers the requests sent so far the way the API does, from the terms above.
  // The page used to ask the API's label filter, which shows each term with all of its labels.
  const answer = () => {
    for (const req of http.match(() => true)) {
      const { method, url, params } = req.request;
      if (method !== 'GET') {
        req.flush(null);
      } else if (url === `${projectUrl}/terms`) {
        req.flush({ data: terms });
      } else if (url === `${projectUrl}/terms/filter-by-label`) {
        req.flush({ data: terms.filter(t => t.labels.some(l => l.id === params.get('labelId'))) });
      } else if (url === `${projectUrl}/labels`) {
        req.flush({ data: [labelA, labelB] });
      }
    }
  };

  // Lets the page react. The filter used to wait 300 ms before it applied.
  const settle = () => {
    tick(300);
    answer();
    fixture.detectChanges();
  };

  const shownIds = () => shown.map(t => t.id);

  const pickLabel = (labelId: string) => {
    fixture.componentInstance.labelFilterControl.setValue(labelId);
    settle();
  };

  beforeEach(fakeAsync(() => {
    TestBed.configureTestingModule({
      imports: [NgxsModule.forRoot([TermsState, ProjectLabelState]), ReactiveFormsModule, AllowAllPipe],
      declarations: [TermsListComponent],
      schemas: [NO_ERRORS_SCHEMA],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(TermsListComponent);
    Object.defineProperty(fixture.componentInstance, 'project$', { value: of({ id: 'p1' }), configurable: true });
    fixture.detectChanges();
    sub = fixture.componentInstance.filteredTerms$.subscribe(list => (shown = list));
    settle();
  }));

  afterEach(() => {
    sub.unsubscribe();
    fixture.destroy();
  });

  it('shows the terms with the picked label, each with all of its labels', fakeAsync(() => {
    expect(shownIds()).toEqual(['t1', 't2', 't3']);

    pickLabel(labelA.id);

    expect(shownIds()).toEqual(['t1']);
    expect(shown[0].labels.map(l => l.id)).toEqual([labelA.id, labelB.id]);

    pickLabel('');

    expect(shownIds()).toEqual(['t1', 't2', 't3']);
  }));

  it('drops a term from the list when the picked label is removed from it', fakeAsync(() => {
    pickLabel(labelA.id);
    expect(shownIds()).toEqual(['t1']);

    fixture.componentInstance.unlabelTerm('p1', 't1', labelA);
    http.expectOne({ method: 'DELETE', url: `${projectUrl}/labels/${labelA.id}/terms/t1` }).flush(null);
    settle();

    expect(shownIds()).toEqual([]);
  }));

  it('drops a deleted term from the list', fakeAsync(() => {
    spyOn(window, 'confirm').and.returnValue(true);
    pickLabel(labelB.id);
    expect(shownIds()).toEqual(['t1', 't2']);

    fixture.componentInstance.deleteTerm('p1', 't1');
    http.expectOne({ method: 'DELETE', url: `${projectUrl}/terms/t1` }).flush(null);
    settle();

    expect(shownIds()).toEqual(['t2']);
  }));

  it('applies the picked label to a list subscribed later, as the search box does for each search', fakeAsync(() => {
    pickLabel(labelA.id);

    let later: Term[];
    const laterSub = fixture.componentInstance.filteredTerms$.subscribe(list => (later = list));
    settle();
    laterSub.unsubscribe();

    expect(later.map(t => t.id)).toEqual(['t1']);
  }));

  it('adds a term to the list when it gets the picked label', fakeAsync(() => {
    pickLabel(labelA.id);
    expect(shownIds()).toEqual(['t1']);

    fixture.componentInstance.labelTerm('p1', 't3', labelA);
    http.expectOne({ method: 'POST', url: `${projectUrl}/labels/${labelA.id}/terms/t3` }).flush(null);
    settle();

    expect(shownIds()).toEqual(['t1', 't3']);
  }));
});

describe('TermsListComponent delete buttons', () => {
  const projectUrl = `${environment.apiEndpoint}/projects/p1`;
  const terms: Term[] = [
    { id: 't1', value: 'greeting', context: null, labels: [] },
    { id: 't2', value: 'farewell', context: null, labels: [] },
  ];

  let fixture: ComponentFixture<TermsListComponent>;
  let http: HttpTestingController;

  // The search box renders the cards, so the delete buttons are in the page as a user finds them
  beforeEach(fakeAsync(() => {
    TestBed.configureTestingModule({
      imports: [NgxsModule.forRoot([TermsState, ProjectLabelState]), ReactiveFormsModule, NgbPaginationModule, AllowAllPipe],
      declarations: [TermsListComponent, SearchComponent],
      schemas: [NO_ERRORS_SCHEMA],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(TermsListComponent);
    Object.defineProperty(fixture.componentInstance, 'project$', { value: of({ id: 'p1' }), configurable: true });
    fixture.detectChanges();
    http.expectOne({ method: 'GET', url: `${projectUrl}/terms` }).flush({ data: terms });
    http.expectOne({ method: 'GET', url: `${projectUrl}/labels` }).flush({ data: [] });
    // The search box debounces its results
    tick(100);
    fixture.detectChanges();
  }));

  afterEach(() => fixture.destroy());

  // A card holds one button of its own: the editable fields and the labels are not rendered here
  const deleteButtons = (): HTMLButtonElement[] =>
    Array.from(fixture.nativeElement.querySelectorAll('.card'), (card: Element) => card.querySelector('button'));

  it('names the delete button of each term after the term, and hides the icon text', fakeAsync(() => {
    const buttons = deleteButtons();

    expect(buttons.map(b => b.getAttribute('aria-label'))).toEqual(['Delete term greeting', 'Delete term farewell']);
    expect(buttons.map(b => b.getAttribute('type'))).toEqual(['button', 'button']);
    expect(buttons.map(b => b.querySelector('i.material-icons').getAttribute('aria-hidden'))).toEqual(['true', 'true']);
  }));

  it('deletes the term the button found by its name is for', fakeAsync(() => {
    spyOn(window, 'confirm').and.returnValue(true);
    const button: HTMLButtonElement | null = fixture.nativeElement.querySelector('button[aria-label="Delete term farewell"]');

    expect(button).withContext('the button named "Delete term farewell"').not.toBeNull();
    button?.click();

    expect(http.match({ method: 'DELETE', url: `${projectUrl}/terms/t2` }).length).toBe(1);
    expect(http.match({ method: 'DELETE' }).length).toBe(0);
  }));
});
