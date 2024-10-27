import { Component, Input } from '@angular/core';
import { Locale } from '../../../projects/models/locale';

@Component({
  selector: 'app-country-flag',
  templateUrl: './country-flag.component.html',
  styleUrls: ['./country-flag.component.css'],
})
export class CountryFlagComponent  {
  @Input()
  locale: Locale;

  localeIconCode(code: string): string | undefined {
    const match = code.match('.*_([A-Z]{2})$');
    if (match) {
      return match[1].toLowerCase();
    }
    // Default codes
    switch (code) {
      case 'en':
        return 'gb';
      case 'de':
        return 'de';
      case 'es':
        return 'es';
      case 'fr':
        return 'fr';
      case 'nl':
        return 'nl';
    }
    return undefined;
  }
}
