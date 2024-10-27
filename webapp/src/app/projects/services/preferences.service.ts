import { Injectable } from '@angular/core';

@Injectable({
  providedIn: 'root',
})
export class PreferencesService {
  forProject = (projectId: string) => ({
    referenceLanguage: {
      get: () => window.localStorage.getItem(`${projectId}.preferredReferenceLanguageCode`),
      set: localeCode => window.localStorage.setItem(`${projectId}.preferredReferenceLanguageCode`, localeCode),
      remove: () => window.localStorage.removeItem(`${projectId}.preferredReferenceLanguageCode`),
    },
  });
}
