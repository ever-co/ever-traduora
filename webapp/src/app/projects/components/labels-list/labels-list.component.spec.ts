import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { NO_ERRORS_SCHEMA, Pipe, PipeTransform } from '@angular/core';
import { ComponentFixture, fakeAsync, TestBed, tick } from '@angular/core/testing';
import { NgbPaginationModule } from '@ng-bootstrap/ng-bootstrap';
import { NgxsModule } from '@ngxs/store';
import { of } from 'rxjs';
import { environment } from '../../../../environments/environment';
import { SearchComponent } from '../../../shared/components/search/search.component';
import { Label } from '../../models/label';
import { ProjectLabelState } from '../../stores/project-label.state';
import { LabelsListComponent } from './labels-list.component';

@Pipe({ name: 'can' })
class AllowAllPipe implements PipeTransform {
  transform() {
    return of(true);
  }
}

describe('LabelsListComponent delete buttons', () => {
  const projectUrl = `${environment.apiEndpoint}/projects/p1`;
  const labels: Label[] = [
    { id: 'l1', value: 'todo', color: '#304D6D' },
    { id: 'l2', value: 'reviewed', color: '#A7CCED' },
  ];

  let fixture: ComponentFixture<LabelsListComponent>;
  let http: HttpTestingController;

  // The search box renders the cards, so the delete buttons are in the page as a user finds them
  beforeEach(fakeAsync(() => {
    TestBed.configureTestingModule({
      imports: [NgxsModule.forRoot([ProjectLabelState]), NgbPaginationModule, AllowAllPipe],
      declarations: [LabelsListComponent, SearchComponent],
      schemas: [NO_ERRORS_SCHEMA],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(LabelsListComponent);
    Object.defineProperty(fixture.componentInstance, 'project$', { value: of({ id: 'p1' }), configurable: true });
    fixture.detectChanges();
    http.expectOne({ method: 'GET', url: `${projectUrl}/labels` }).flush({ data: labels });
    // The search box debounces its results
    tick(100);
    fixture.detectChanges();
  }));

  afterEach(() => fixture.destroy());

  // A card holds one button of its own: the label and its edit button are not rendered here
  const deleteButtons = (): HTMLButtonElement[] =>
    Array.from(fixture.nativeElement.querySelectorAll('.card'), (card: Element) => card.querySelector('button'));

  it('names the delete button of each label after the label, and hides the icon text', fakeAsync(() => {
    const buttons = deleteButtons();

    expect(buttons.map(b => b.getAttribute('aria-label'))).toEqual(['Delete label todo', 'Delete label reviewed']);
    expect(buttons.map(b => b.getAttribute('type'))).toEqual(['button', 'button']);
    expect(buttons.map(b => b.querySelector('i.material-icons').getAttribute('aria-hidden'))).toEqual(['true', 'true']);
  }));

  it('deletes the label the button found by its name is for', fakeAsync(() => {
    spyOn(window, 'confirm').and.returnValue(true);
    const button: HTMLButtonElement | null = fixture.nativeElement.querySelector('button[aria-label="Delete label reviewed"]');

    expect(button).withContext('the button named "Delete label reviewed"').not.toBeNull();
    button?.click();

    expect(http.match({ method: 'DELETE', url: `${projectUrl}/labels/l2` }).length).toBe(1);
    expect(http.match({ method: 'DELETE' }).length).toBe(0);
  }));
});
