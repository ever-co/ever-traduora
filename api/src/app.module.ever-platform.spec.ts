import 'reflect-metadata';

/**
 * AppModule loads the anonymous usage statistics (and the installation identity they need) unless
 * TR_EVER_STATS_ENABLED is exactly 'false'; the entities registered in AppModule itself stay the same.
 */
describe('AppModule and the anonymous usage statistics', () => {
  const original = process.env.TR_EVER_STATS_ENABLED;

  afterEach(() => {
    if (original === undefined) delete process.env.TR_EVER_STATS_ENABLED;
    else process.env.TR_EVER_STATS_ENABLED = original;
  });

  /** AppModule's imports, loaded afresh with TR_EVER_STATS_ENABLED set to `value` (undefined = unset). */
  const load = (value: string | undefined) => {
    if (value === undefined) delete process.env.TR_EVER_STATS_ENABLED;
    else process.env.TR_EVER_STATS_ENABLED = value;
    let result: { names: string[]; features: string[] };
    jest.isolateModules(() => {
      const { AppModule } = require('./app.module');
      const imports: any[] = Reflect.getMetadata('imports', AppModule);
      const names = imports.map(entry => entry?.name ?? entry?.module?.name).filter(Boolean);
      // TypeOrmModule.forFeature([...]) of AppModule: the entities registered there
      const feature = imports.find(entry => entry?.module?.name === 'TypeOrmModule' && Array.isArray(entry.providers) && entry.providers.length > 1);
      const features = (feature?.providers ?? []).map(provider => String(provider.provide)).sort();
      result = { names, features };
    });
    return result;
  };

  it("leaves both modules out with exactly 'false'", () => {
    const { names } = load('false');
    expect(names).not.toContain('EverInstanceModule');
    expect(names).not.toContain('EverStatsModule');
  });

  it.each([[undefined], [''], ['true'], ['garbage'], ['FALSE']])('loads both modules when TR_EVER_STATS_ENABLED is %p', value => {
    const { names } = load(value);
    expect(names).toEqual(expect.arrayContaining(['EverInstanceModule', 'EverStatsModule']));
  });

  it('keeps the entities AppModule registers itself unchanged', () => {
    const on = load(undefined).features;
    const off = load('false').features;
    expect(on).toEqual(off);
    expect(on.join(' ')).not.toMatch(/EverInstance|EverStats/);
    expect(on.length).toBe(14);
  });
});
