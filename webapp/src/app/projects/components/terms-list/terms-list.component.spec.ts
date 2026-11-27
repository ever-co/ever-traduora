import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { NO_ERRORS_SCHEMA, Pipe, PipeTransform } from '@angular/core';
import { ComponentFixture, fakeAsync, TestBed, tick } from '@angular/core/testing';
import { ReactiveFormsModule } from '@angular/forms';
import { NgxsModule, Store } from '@ngxs/store';
import { of, Subscription } from 'rxjs';
import { environment } from '../../../../environments/environment';
import { ErrorMessageComponent } from '../../../shared/components/error-message/error-message.component';
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
      declarations: [TermsListComponent, ErrorMessageComponent],
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

  // The API refuses a label of a term, for example one deleted in another tab (404)
  describe('a label the API refuses', () => {
    const notFound = { status: 404, statusText: 'Not Found' };

    const errorMessage = (): string | undefined => fixture.nativeElement.querySelector('app-error-message p')?.textContent.trim();

    const labelIds = (termId: string) => shown.find(t => t.id === termId).labels.map(l => l.id);

    const failLabel = () => {
      fixture.componentInstance.labelTerm('p1', 't3', labelA);
      http.expectOne({ method: 'POST', url: `${projectUrl}/labels/${labelA.id}/terms/t3` }).flush(null, notFound);
      settle();
    };

    it('takes the label off the term again and shows the error', fakeAsync(() => {
      failLabel();

      expect(labelIds('t3')).toEqual([]);
      expect(errorMessage()).toBe('Error, resource not found');
    }));

    it('puts a label it could not remove back on the term and shows the error', fakeAsync(() => {
      fixture.componentInstance.unlabelTerm('p1', 't1', labelA);
      http.expectOne({ method: 'DELETE', url: `${projectUrl}/labels/${labelA.id}/terms/t1` }).flush(null, notFound);
      settle();

      expect(labelIds('t1')).toEqual(jasmine.arrayWithExactContents([labelA.id, labelB.id]));
      expect(errorMessage()).toBe('Error, resource not found');
    }));

    it('drops the error once a label is added, and when the page is left', fakeAsync(() => {
      failLabel();

      fixture.componentInstance.labelTerm('p1', 't2', labelA);
      settle();
      expect(labelIds('t2')).toEqual([labelB.id, labelA.id]);
      expect(errorMessage()).toBeUndefined();

      failLabel();
      expect(errorMessage()).toBe('Error, resource not found');
      fixture.destroy();
      expect(TestBed.inject(Store).selectSnapshot(state => state.projectLabels.errorMessage)).toBeUndefined();
    }));
  });
});
