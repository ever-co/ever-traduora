import { Component, EventEmitter, Input, OnChanges, Output } from '@angular/core';
import { BehaviorSubject, merge, Observable, Subject } from 'rxjs';
import { debounceTime, distinctUntilChanged, map } from 'rxjs/operators';
import { Label } from '../../../projects/models/label';

@Component({
  selector: 'app-select-label',
  templateUrl: './select-label.component.html',
  styleUrls: ['./select-label.component.css'],
})
export class SelectLabelComponent implements OnChanges {
  @Input()
  labels: Label[] = [];

  @Input()
  exclude: Label[] = [];

  @Input()
  limit = 25;

  @Input()
  loading = false;

  @Input()
  preserveHeight = false;

  @Output()
  selectLabel = new EventEmitter<Label>();

  selection: Label | undefined;

  text$ = new BehaviorSubject<string>('');

  private ngChanged$ = new Subject<string>();
  private debouncedText$ = this.text$.pipe(
    debounceTime(50),
    map(text => text.trim().toLowerCase()),
    distinctUntilChanged(),
  );

  results$: Observable<Label[]> = merge(this.debouncedText$, this.ngChanged$).pipe(
    map(text => {
      if (text === '') {
        return this.defaultLabels();
      }

      const tokens = text.toLowerCase().split(' ');

      return this.availableLabels()
        .filter(label => {
          const searchString = this.labelToSearchString(label);
          for (const token of tokens) {
            if (searchString.indexOf(token) === -1) {
              return false;
            }
          }
          return true;
        })
        .slice(0, this.limit);
    }),
  );

  ngOnChanges() {
    this.ngChanged$.next(this.text$.getValue());
  }

  select(label: Label) {
    this.selection = label;
    this.selectLabel.emit(label);
  }

  defaultLabels(): Label[] {
    const all = this.availableLabels();
    if (all.length < this.limit) {
      return all.slice(0, this.limit);
    }
    return all.slice(0, this.limit);
  }

  availableLabels() {
    return this.labels.filter(v => !this.exclude.map(x => x.id).includes(v.id));
  }

  labelToSearchString(label: Label): string {
    return label.value.toLowerCase();
  }
}
