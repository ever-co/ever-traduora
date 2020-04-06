import { Component, EventEmitter, Input, OnInit, Output } from '@angular/core';
import { NgbModal, NgbModalRef } from '@ng-bootstrap/ng-bootstrap';
import { Locale } from '../../../projects/models/locale';

@Component({
  selector: 'app-select-locale-modal',
  templateUrl: './select-locale-modal.component.html',
  styleUrls: ['./select-locale-modal.component.css'],
})
export class SelectLocaleModalComponent implements OnInit {
  @Input()
  btnClass = 'btn-light';

  @Input()
  currentLocale: Locale | undefined;

  @Input()
  readonly = false;

  @Input()
  noSelectionLabel: String;

  @Input()
  locales: Locale[] = [];

  @Input()
  exclude: Locale[] = [];

  @Output()
  select = new EventEmitter<Locale>();

  selectedLocale: Locale | undefined;

  modal: NgbModalRef | undefined;

  constructor(private modalService: NgbModal) {}

  ngOnInit() {}

  open(content) {
    this.modal = this.modalService.open(content);
    this.modal.result.then(
      () => this.reset(),
      () => this.reset(),
    );
  }

  confirmSelection() {
    this.select.emit(this.selectedLocale);
    this.modal.close();
  }

  isValid() {
    return !!this.selectedLocale;
  }

  reset() {
    this.selectedLocale = undefined;
  }
}
