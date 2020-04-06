import { Component, EventEmitter, Input, OnInit, Output } from '@angular/core';
import { NgbModal, NgbModalRef } from '@ng-bootstrap/ng-bootstrap';
import { Locale } from '../../../projects/models/locale';

@Component({
  selector: 'app-new-locale',
  templateUrl: './new-locale.component.html',
  styleUrls: ['./new-locale.component.css'],
})
export class NewLocaleComponent implements OnInit {
  @Input()
  btnClass = 'btn-light';

  @Input()
  locales: Locale[] = [];

  @Input()
  exclude: Locale[] = [];

  @Output()
  add = new EventEmitter<Locale>();

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
    this.add.emit(this.selectedLocale);
    this.modal.close();
  }

  isValid() {
    return !!this.selectedLocale;
  }

  reset() {
    this.selectedLocale = undefined;
  }
}
