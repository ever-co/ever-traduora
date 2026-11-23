// This suite never phones home: the statistics are switched off before the configuration is read
process.env.TR_EVER_STATS_ENABLED = 'false';
delete process.env.TR_EVER_CONNECT_ENABLED;

import { AppModule, IndexModule } from './app.module';
import { config } from './config';
import { EverConnectModule } from './ever-connect/ever-connect.module';
import { EverInstanceModule } from './ever-instance/ever-instance.module';
import { readEverPlatformConfig } from './ever-platform/env';
import { everPlatformModules } from './ever-platform/modules';
import { EverStatsModule } from './ever-stats/ever-stats.module';

describe('AppModule and the optional Ever Platform modules', () => {
  const imports = (): unknown[] => Reflect.getMetadata('imports', AppModule);

  it('imports none of them with TR_EVER_STATS_ENABLED=false and the connection unset', () => {
    expect(config.everPlatform.statsEnabled).toBe(false);
    expect(config.everPlatform.connectEnabled).toBe(false);
    expect(imports()).not.toContain(EverInstanceModule);
    expect(imports()).not.toContain(EverStatsModule);
    expect(imports()).not.toContain(EverConnectModule);
  });

  it('imports the statistics and the identity by default, and the connection only when switched on', () => {
    const quiet = () => undefined;
    for (const env of [{}, { TR_EVER_STATS_ENABLED: '' }, { TR_EVER_STATS_ENABLED: 'garbage' }, { TR_EVER_STATS_ENABLED: 'true' }]) {
      expect(everPlatformModules(readEverPlatformConfig(env, quiet))).toEqual([EverInstanceModule, EverStatsModule]);
    }
    expect(everPlatformModules(readEverPlatformConfig({ TR_EVER_STATS_ENABLED: 'false' }, quiet))).toEqual([]);
    expect(everPlatformModules(readEverPlatformConfig({ TR_EVER_STATS_ENABLED: 'false', TR_EVER_CONNECT_ENABLED: 'true' }, quiet))).toEqual([
      EverInstanceModule,
      EverConnectModule,
    ]);
  });

  it('imports each module only when switched on, and the identity when either is', () => {
    expect(everPlatformModules({ statsEnabled: false, connectEnabled: false })).toEqual([]);
    expect(everPlatformModules({ statsEnabled: true, connectEnabled: false })).toEqual([EverInstanceModule, EverStatsModule]);
    expect(everPlatformModules({ statsEnabled: false, connectEnabled: true })).toEqual([EverInstanceModule, EverConnectModule]);
    expect(everPlatformModules({ statsEnabled: true, connectEnabled: true })).toEqual([EverInstanceModule, EverStatsModule, EverConnectModule]);
  });

  it('keeps the catch-all index route last, after every API route', () => {
    const list = imports();
    expect(list[list.length - 1]).toBe(IndexModule);
  });
});
