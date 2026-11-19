import { Component } from '@angular/core';
import { environment } from '../../../../environments/environment';

/** Whether the page was served by a demo install (`TR_DEMO=true`): the API then adds this tag to index.html. */
export const isDemoInstall = (doc: Document = document): boolean =>
  doc.querySelector('meta[name="traduora-demo"]')?.getAttribute('content') === 'true';

/**
 * The strip above the app bar of a demo install (demo.traduora.co), the same notice demo.gauzy.co shows: this is
 * a demo account, and where to get Traduora for real. Renders nothing on any other install.
 */
@Component({
  standalone: false,
  selector: 'app-demo-banner',
  templateUrl: './demo-banner.component.html',
  styleUrls: ['./demo-banner.component.css'],
})
export class DemoBannerComponent {
  readonly isDemo = isDemoInstall();
  readonly homepage = environment.homepage;
}
