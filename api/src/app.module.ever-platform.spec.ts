import { AppModule, IndexModule } from './app.module';
import { config } from './config';
import { EverInstanceModule } from './ever-instance/ever-instance.module';
import { everPlatformModules } from './ever-platform/modules';
import { EverStatsModule } from './ever-stats/ever-stats.module';

describe('AppModule and the optional Ever Platform modules', () => {
  const imports = (): unknown[] => Reflect.getMetadata('imports', AppModule);

  it('imports none of them with the default configuration', () => {
    expect(process.env.TR_EVER_STATS_ENABLED || '').not.toBe('true');
    expect(config.everPlatform.statsEnabled).toBe(false);
    expect(imports()).not.toContain(EverInstanceModule);
    expect(imports()).not.toContain(EverStatsModule);
  });

  it('imports the statistics and the identity they need only when switched on', () => {
    expect(everPlatformModules({ statsEnabled: false })).toEqual([]);
    expect(everPlatformModules({ statsEnabled: true })).toEqual([EverInstanceModule, EverStatsModule]);
  });

  it('keeps the catch-all index route last, after every API route', () => {
    const list = imports();
    expect(list[list.length - 1]).toBe(IndexModule);
  });
});
