import { config } from '../config';
import { CorpusIndex, corpusVersion, currentLegalDocuments, isCurrentAcceptance, LEGAL_PRODUCT } from './legal-documents';

describe('legal documents (DESIGN §3.8)', () => {
  const saved = { terms: { ...config.accounts.terms }, privacy: { ...config.accounts.privacy } };
  const index: CorpusIndex = {
    documents: [
      { product: LEGAL_PRODUCT, document: 'tos', locale: 'en', version: '1.1.0', publishable: true },
      { product: LEGAL_PRODUCT, document: 'tos', locale: 'de', version: '0.9.0' },
      { product: LEGAL_PRODUCT, document: 'privacy', locale: 'en', version: '1.0.2' },
      { product: 'ever-rec', document: 'privacy', locale: 'en', version: '7.0.0' },
      { product: LEGAL_PRODUCT, document: 'cookies', locale: 'en', version: '1.0.0' },
    ],
  };

  afterEach(() => {
    Object.assign(config.accounts.terms, saved.terms);
    Object.assign(config.accounts.privacy, saved.privacy);
  });

  it('reads the English versions of Traduora from the corpus, and nothing of another product or an unpublished text', () => {
    expect(corpusVersion('tos', index)).toBe('1.1.0');
    expect(corpusVersion('privacy', index)).toBe('1.0.2');
    expect(corpusVersion('privacy', { documents: [{ ...index.documents[2], publishable: false }] })).toBeUndefined();
    expect(corpusVersion('tos', null)).toBeUndefined();
  });

  it('finds both documents in the installed @ever-co/legal package', () => {
    expect(corpusVersion('tos')).toMatch(/^\d+\.\d+\.\d+$/);
    expect(corpusVersion('privacy')).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('answers the documents in force, with the links, and lets TR_TERMS_VERSION and TR_PRIVACY_VERSION set them', () => {
    expect(currentLegalDocuments(index)).toEqual({
      terms: { version: '1.1.0', url: 'https://traduora.co/tos' },
      privacy: { version: '1.0.2', url: 'https://traduora.co/privacy' },
    });
    config.accounts.terms.version = '2026-11';
    config.accounts.privacy.url = 'https://example.com/privacy';
    expect(currentLegalDocuments(index)).toEqual({
      terms: { version: '2026-11', url: 'https://traduora.co/tos' },
      privacy: { version: '1.0.2', url: 'https://example.com/privacy' },
    });
    // Without a version for either, there is nothing to accept
    config.accounts.terms.version = undefined;
    expect(currentLegalDocuments({ documents: [] })).toBeUndefined();
  });

  it('counts only an acceptance of both versions in force', () => {
    const current = currentLegalDocuments(index);
    expect(isCurrentAcceptance({ termsVersion: '1.1.0', privacyVersion: '1.0.2' }, current)).toBe(true);
    expect(isCurrentAcceptance({ termsVersion: '1.0.2', privacyVersion: '1.0.2' }, current)).toBe(false);
    expect(isCurrentAcceptance({ termsVersion: '1.1.0' }, current)).toBe(false);
    expect(isCurrentAcceptance({ termsVersion: null, privacyVersion: null }, current)).toBe(false);
    expect(isCurrentAcceptance(undefined, current)).toBe(false);
    expect(isCurrentAcceptance({ termsVersion: '1.1.0', privacyVersion: '1.0.2' }, null)).toBe(false);
  });
});
