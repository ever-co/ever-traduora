describe('config', () => {
  const maxProjectsPerUser = process.env.TR_MAX_PROJECTS_PER_USER;

  afterEach(() => {
    if (maxProjectsPerUser === undefined) {
      delete process.env.TR_MAX_PROJECTS_PER_USER;
    } else {
      process.env.TR_MAX_PROJECTS_PER_USER = maxProjectsPerUser;
    }

    jest.resetModules();
  });

  it('keeps a zero max project limit from the environment', async () => {
    jest.resetModules();
    process.env.TR_MAX_PROJECTS_PER_USER = '0';

    const { config } = await import('./config');

    expect(config.maxProjectsPerUser).toBe(0);
  });
});
