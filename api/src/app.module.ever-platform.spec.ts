import { AppModule, IndexModule } from './app.module';
import { config } from './config';
import { EverConnectModule } from './ever-connect/ever-connect.module';
import { EverInstanceModule } from './ever-instance/ever-instance.module';
import { everPlatformModules } from './ever-platform/modules';
import { EverStatsModule } from './ever-stats/ever-stats.module';

describe('AppModule and the optional Ever Platform modules', () => {
  const imports = (): unknown[] => Reflect.getMetadata('imports', AppModule);

  it('imports none of them with the default configuration', () => {
    expect(process.env.TR_EVER_STATS_ENABLED || '').not.toBe('true');
    expect(config.everPlatform.statsEnabled).toBe(false);
    expect(config.everPlatform.connectEnabled).toBe(false);
    expect(imports()).not.toContain(EverInstanceModule);
    expect(imports()).not.toContain(EverStatsModule);
    expect(imports()).not.toContain(EverConnectModule);
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
