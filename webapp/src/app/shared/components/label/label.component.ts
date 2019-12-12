import { Component, EventEmitter, Input, OnInit, Output } from '@angular/core';
import { Label } from '../../../projects/models/label';
import { hexToHSL } from '../../util/color-utils';

@Component({
  selector: 'app-label',
  templateUrl: './label.component.html',
  styleUrls: ['./label.component.css'],
})
export class LabelComponent implements OnInit {
  @Input()
  label: Label;

  @Input()
  removable = false;

  private darkText = '#202020';
  private lightText = '#f0f0f0';

  get textColor(): string {
    if (this.label) {
      const hsl = hexToHSL(this.label.color);
      return hsl.luminance >= 50 ? this.darkText : this.lightText;
    }
    return this.lightText;
  }

  @Output()
  save = new EventEmitter<Label>();

  @Output()
  remove = new EventEmitter<Label>();

  constructor() {}

  ngOnInit() {}

  onRemove() {
    this.remove.emit(this.label);
  }
}
