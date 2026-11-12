import { Label } from '../entity/label.entity';
import ProjectLabelController, { withLabel } from './project-label.controller';

const label = (id: string) => ({ id, value: id, color: '#ffffff' }) as Label;

describe('withLabel', () => {
  it('adds a label that is not there yet', () => {
    const a = label('a');
    const b = label('b');

    expect(withLabel([a], b)).toEqual([a, b]);
    expect(withLabel([], a)).toEqual([a]);
  });

  it('keeps the labels unchanged when the label is already there', () => {
    const a = label('a');
    const b = label('b');

    expect(withLabel([a, b], label('a'))).toEqual([a, b]);
  });
});

describe('ProjectLabelController labelling is idempotent', () => {
  const projectId = 'p1';
  const a = label('a');
  const b = label('b');

  const build = (term: any, translations: any[]) => {
    const saved: { terms: any[]; translations: any[] } = { terms: [], translations: [] };
    const auth = {
      getRequestUserOrClient: () => ({}),
      authorizeProjectAction: async () => ({ project: { id: projectId } }),
    };
    const labelRepo = { findOneOrFail: async () => a };
    const termsRepo = {
      findOneOrFail: async () => term,
      save: async (t: any) => saved.terms.push(t),
    };
    const projectLocaleRepo = { findOneOrFail: async () => ({ id: 'pl1' }) };
    const translationsRepo = {
      find: async () => translations,
      findOneOrFail: async () => translations[0],
      save: async (t: any) => saved.translations.push(t),
    };
    const controller = new ProjectLabelController(auth as any, labelRepo as any, termsRepo as any, projectLocaleRepo as any, translationsRepo as any);
    return { controller, saved };
  };

  it('does not attach a label to a term (or its translations) twice', async () => {
    const term = { id: 't1', labels: [a] };
    const translations = [
      { termId: 't1', labels: [a, b] },
      { termId: 't1', labels: [b] },
    ];
    const { controller, saved } = build(term, translations);

    await controller.labelTerm({}, projectId, 'a', 't1');

    expect(saved.terms[0].labels.map((l: Label) => l.id)).toEqual(['a']);
    expect(saved.translations[0].map((t: any) => t.labels.map((l: Label) => l.id))).toEqual([['a', 'b'], ['b', 'a']]);
  });

  it('does not attach a label to a translation twice', async () => {
    const translation = { termId: 't1', labels: [a] };
    const { controller, saved } = build({ id: 't1', labels: [] }, [translation]);

    await controller.labelTranslation({}, projectId, 'a', 't1', 'en');

    expect(saved.translations[0].labels.map((l: Label) => l.id)).toEqual(['a']);
  });

  it('still attaches a label that is missing', async () => {
    const translation = { termId: 't1', labels: [b] };
    const { controller, saved } = build({ id: 't1', labels: [] }, [translation]);

    await controller.labelTranslation({}, projectId, 'a', 't1', 'en');

    expect(saved.translations[0].labels.map((l: Label) => l.id)).toEqual(['b', 'a']);
  });
});
