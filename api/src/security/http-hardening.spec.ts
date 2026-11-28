import { corsOptions, GOOGLE_FONTS_FILES, GOOGLE_FONTS_STYLES, helmetOptions, isHttps, TURNSTILE_ORIGIN } from './http-hardening';

describe('HTTP hardening (DESIGN §3.8)', () => {
  const base = { virtualHost: 'http://localhost:8080', turnstile: false, corsEnabled: false, corsOrigins: [] };
  const directivesOf = (settings: Partial<typeof base> & { everIdIssuer?: string }) =>
    (helmetOptions({ ...base, ...settings }).contentSecurityPolicy as { directives: Record<string, string[]> }).directives;

  it('allows the app itself and Google Fonts, and nothing else by default', () => {
    const directives = directivesOf({});
    expect(directives.defaultSrc).toEqual(["'self'"]);
    expect(directives.scriptSrc).toEqual(["'self'"]);
    expect(directives.scriptSrcAttr).toEqual(["'none'"]);
    expect(directives.styleSrc).toEqual(["'self'", "'unsafe-inline'", GOOGLE_FONTS_STYLES]);
    expect(directives.fontSrc).toEqual(["'self'", GOOGLE_FONTS_FILES, 'data:']);
    expect(directives.connectSrc).toEqual(["'self'"]);
    expect(directives.frameSrc).toEqual(["'self'"]);
    expect(directives.objectSrc).toEqual(["'none'"]);
    expect(directives.upgradeInsecureRequests).toBeUndefined();
  });

  it('adds Turnstile and the Ever ID issuer only when they are configured', () => {
    const directives = directivesOf({ turnstile: true, everIdIssuer: 'https://id.ever.co/oauth/v2/' });
    expect(directives.scriptSrc).toEqual(["'self'", TURNSTILE_ORIGIN]);
    expect(directives.frameSrc).toEqual(["'self'", TURNSTILE_ORIGIN, 'https://id.ever.co']);
    expect(directives.connectSrc).toEqual(["'self'", 'https://id.ever.co']);
    expect(directives.formAction).toEqual(["'self'", 'https://id.ever.co']);
    // An issuer that is no URL adds nothing
    expect(directivesOf({ everIdIssuer: 'not a url' }).connectSrc).toEqual(["'self'"]);
  });

  it('sends HSTS for one year with sub-domains, and upgrades requests, only on an https host', () => {
    expect(helmetOptions(base).strictTransportSecurity).toBe(false);
    const https = helmetOptions({ ...base, virtualHost: 'https://app.traduora.co' });
    expect(https.strictTransportSecurity).toEqual({ maxAge: 31536000, includeSubDomains: true });
    expect(directivesOf({ virtualHost: 'https://app.traduora.co' }).upgradeInsecureRequests).toEqual([]);
    expect(isHttps('nonsense')).toBe(false);
  });

  it('answers the CORS allowlist first, then * for TR_CORS_ENABLED, else nothing', () => {
    expect(corsOptions({ corsEnabled: true, corsOrigins: ['https://a.example'] })).toEqual({ origin: ['https://a.example'] });
    expect(corsOptions({ corsEnabled: false, corsOrigins: ['https://a.example'] })).toEqual({ origin: ['https://a.example'] });
    expect(corsOptions({ corsEnabled: true, corsOrigins: [] })).toEqual({ origin: '*' });
    expect(corsOptions({ corsEnabled: false, corsOrigins: [] })).toBeUndefined();
  });
});
