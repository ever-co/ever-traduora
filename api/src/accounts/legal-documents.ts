import { config } from '../config';

/**
 * The terms of service and privacy policy a person accepts at sign-up in SaaS mode (DESIGN §3.8), as Ever Rec does:
 * the versions come from the published legal corpus `@ever-co/legal` (product `traduora`, English), unless
 * TR_TERMS_VERSION / TR_PRIVACY_VERSION set them. A new version of either asks everyone to accept again.
 */

/** The product this installation publishes its documents under in the legal corpus. */
export const LEGAL_PRODUCT = 'traduora';

/** One document of the corpus index (`@ever-co/legal/index.json`), as far as it is read here. */
export interface CorpusDocument {
  document: string;
  product: string;
  locale: string;
  version: string;
  publishable?: boolean;
}

export interface CorpusIndex {
  documents: CorpusDocument[];
}

export interface LegalDocument {
  version: string;
  /** Where the person reads it */
  url: string;
}

export interface LegalDocuments {
  terms: LegalDocument;
  privacy: LegalDocument;
}

/** The versions a person accepted (the `user` columns) or sends with an acceptance. */
export interface AcceptedVersions {
  termsVersion?: string | null;
  privacyVersion?: string | null;
}

let loadedCorpus: CorpusIndex | null | undefined;

/**
 * The corpus index, read once. `require` rather than an import: the package exposes it only through its `exports` map
 * (`@ever-co/legal/index.json`), which Node and TypeScript both resolve this way. `null` when it cannot be read.
 */
function corpus(): CorpusIndex | null {
  if (loadedCorpus === undefined) {
    try {
      // tslint:disable-next-line:no-var-requires
      loadedCorpus = require('@ever-co/legal/index.json') as CorpusIndex;
    } catch {
      loadedCorpus = null;
    }
  }
  return loadedCorpus;
}

/** The published English version of a document of this product in the corpus. */
export function corpusVersion(document: 'tos' | 'privacy', index: CorpusIndex | null = corpus()): string | undefined {
  const published = index?.documents?.find(
    each => each.product === LEGAL_PRODUCT && each.document === document && each.locale === 'en' && each.publishable !== false,
  );
  return published?.version;
}

/** The documents in force now, `undefined` when a version is known for neither the configuration nor the corpus. */
export function currentLegalDocuments(index: CorpusIndex | null = corpus()): LegalDocuments | undefined {
  const termsVersion = config.accounts.terms.version ?? corpusVersion('tos', index);
  const privacyVersion = config.accounts.privacy.version ?? corpusVersion('privacy', index);
  if (!termsVersion || !privacyVersion) {
    return undefined;
  }
  return {
    terms: { version: termsVersion, url: config.accounts.terms.url },
    privacy: { version: privacyVersion, url: config.accounts.privacy.url },
  };
}

/** Whether these are exactly the versions in force now (both documents). */
export function isCurrentAcceptance(
  accepted: AcceptedVersions | null | undefined,
  current: LegalDocuments | null | undefined = currentLegalDocuments(),
): boolean {
  return !!current && accepted?.termsVersion === current.terms.version && accepted?.privacyVersion === current.privacy.version;
}
