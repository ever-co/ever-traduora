import { EverConnectModule } from '../ever-connect/ever-connect.module';
import { EverInstanceModule } from '../ever-instance/ever-instance.module';
import { EverStatsModule } from '../ever-stats/ever-stats.module';
import { EverPlatformConfig } from './env';

/**
 * The optional Ever Platform modules `AppModule` imports, decided from `config.everPlatform` when the import list is
 * built: the anonymous usage statistics unless `TR_EVER_STATS_ENABLED=false`, the connection only with
 * `TR_EVER_CONNECT_ENABLED=true`, and the instance identity both need when either is on. With both off nothing is
 * imported: no route, no timer, no request.
 */
export function everPlatformModules(settings: Pick<EverPlatformConfig, 'statsEnabled' | 'connectEnabled'>) {
  return [
    ...(settings.statsEnabled || settings.connectEnabled ? [EverInstanceModule] : []),
    ...(settings.statsEnabled ? [EverStatsModule] : []),
    ...(settings.connectEnabled ? [EverConnectModule] : []),
  ];
}
