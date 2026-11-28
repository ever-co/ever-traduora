import { EntityManager } from 'typeorm';
import { IntermediateTranslation } from '../domain/formatters';
import { Term } from '../entity/term.entity';
import { resolveColumnName } from './alias-helper';
import { getLexicalOrderClause } from './database-type-helper';

/**
 * Every term of the project with its translation in one of the project's locales (`''` where it has none), in lexical
 * order: what an export file holds. The project export (`GET /projects/:id/exports`) and the organization export
 * (`GET /organizations/:id/export`) both read it. The caller authorized the project and resolved the project locale
 * as one of that project's.
 */
export async function localeTranslations(
  manager: EntityManager,
  projectId: string,
  projectLocaleId: string,
  options: { untranslated?: boolean } = {},
): Promise<IntermediateTranslation[]> {
  const query = manager
    .createQueryBuilder(Term, 'term')
    .leftJoinAndSelect('term.translations', 'translation', `translation.${resolveColumnName('projectLocaleId')} = :projectLocaleId`, {
      projectLocaleId,
    })
    .where(`term.${resolveColumnName('projectId')} = :projectId`, { projectId });

  query.orderBy(getLexicalOrderClause('term.value'), 'ASC');

  if (options.untranslated) {
    // A term without a row in this locale joins as NULL (e.g. a term created by an import of another locale)
    query.andWhere("(translation.value = '' OR translation.value IS NULL)");
  }

  const terms = await query.getMany();
  return terms.map(term => ({
    term: term.value,
    translation: term.translations.length === 1 ? term.translations[0].value : '',
  }));
}
