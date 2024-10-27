import { animate, state, style, transition, trigger } from '@angular/animations';
import { Component, Input } from '@angular/core';

@Component({
  selector: 'app-loading-indicator',
  templateUrl: './loading-indicator.component.html',
  styleUrls: ['./loading-indicator.component.css'],
  animations: [
    trigger('enterLeave', [
      state('true', style({ opacity: '1' })),
      state('false', style({ opacity: '0' })),
      transition('false <=> true', animate(100)),
    ]),
  ],
})
export class LoadingIndicatorComponent {
  @Input()
  enabled = true;
}
