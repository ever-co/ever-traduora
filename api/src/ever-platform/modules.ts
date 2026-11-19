import { EverInstanceModule } from '../ever-instance/ever-instance.module';
import { EverStatsModule } from '../ever-stats/ever-stats.module';
import { EverPlatformConfig } from './env';

/**
 * The optional Ever Platform modules `AppModule` imports, decided from `config.everPlatform` when the import list is
 * built: the anonymous usage statistics and the instance identity they need, only with `TR_EVER_STATS_ENABLED=true`.
 * Otherwise nothing is imported: no route, no timer, no request.
 */
export function everPlatformModules(settings: Pick<EverPlatformConfig, 'statsEnabled'>) {
  return settings.statsEnabled ? [EverInstanceModule, EverStatsModule] : [];
}
