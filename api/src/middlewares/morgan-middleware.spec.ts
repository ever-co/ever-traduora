import * as morgan from 'morgan';
import { redactUrl, SAFE_SHORT_FORMAT } from './morgan-middleware';

describe('redactUrl', () => {
  it('keeps the path and query keys and redacts every value', () => {
    expect(redactUrl('/reset-password?email=a%40b.c&resetToken=abc')).toBe('/reset-password?email=REDACTED&resetToken=REDACTED');
  });

  it('returns a URL without a query unchanged', () => {
    expect(redactUrl('/projects')).toBe('/projects');
    expect(redactUrl('/projects?')).toBe('/projects?');
  });

  it('redacts values that contain "=" or "?"', () => {
    expect(redactUrl('/signup?invite=a=b?c')).toBe('/signup?invite=REDACTED');
  });

  it('keeps keys without a value', () => {
    expect(redactUrl('/x?flag&token=abc')).toBe('/x?flag&token=REDACTED');
  });

  it('does not throw on malformed input', () => {
    expect(() => redactUrl('/x?%E0%A4%A&=&&')).not.toThrow();
    expect(redactUrl('/x?%E0%A4%A=secret')).toBe('/x?%E0%A4%A=REDACTED');
    expect(redactUrl(undefined as any)).toBe('');
    expect(redactUrl(null as any)).toBe('');
  });
});

describe('access log format', () => {
  const req: any = {
    originalUrl: '/reset-password?email=a%40b.c&resetToken=abc',
    url: '/reset-password?email=a%40b.c&resetToken=abc',
    method: 'GET',
    httpVersionMajor: 1,
    httpVersionMinor: 1,
    headers: {},
    connection: { remoteAddress: '127.0.0.1' },
  };
  const res: any = {
    statusCode: 200,
    getHeader: () => undefined,
    _header: true,
  };

  it('the previous "short" format logged the secret', () => {
    // morgan.compile() treats its argument as a format string, not a predefined name, so resolve the registered 'short' format first
    const previousShortFormat: string = (morgan as any).short;
    expect(previousShortFormat).toContain(':url');
    const line = (morgan as any).compile(previousShortFormat)(morgan, req, res);
    expect(line).toContain('abc');
  });

  it('the safe format is the "short" format with :safe-url in place of :url', () => {
    expect(SAFE_SHORT_FORMAT).toBe(((morgan as any).short as string).replace(':url', ':safe-url'));
  });

  it('the safe format does not log query values', () => {
    const line = (morgan as any).compile(SAFE_SHORT_FORMAT)(morgan, req, res);
    expect(line).not.toContain('abc');
    expect(line).not.toContain('a%40b.c');
    expect(line).toContain('/reset-password?email=REDACTED&resetToken=REDACTED');
  });

  it('falls back to req.url when originalUrl is missing', () => {
    const line = (morgan as any).compile(SAFE_SHORT_FORMAT)(morgan, { ...req, originalUrl: undefined }, res);
    expect(line).not.toContain('abc');
    expect(line).toContain('resetToken=REDACTED');
  });
});
