import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';

/**
 * Static checks of the Ever ID (OpenID Connect) sign-in code: its tokens are verified, never only decoded; the API
 * builds no redirect that could carry a token; no email is put in an authorization request; logs carry no token.
 */
const src = join(__dirname, '..');
const read = (path: string) => readFileSync(join(src, path), 'utf-8').replace(/\r\n/g, '\n');

/** The source of one class member, from its declaration to the next member at the same indentation. */
const member = (source: string, declaration: string): string => {
  const start = source.indexOf(declaration);
  if (start < 0) {
    throw new Error(`${declaration} not found`);
  }
  const rest = source.slice(start + declaration.length);
  const next = rest.search(/\n {2}(?:(?:private |protected |public )?(?:async )?[a-zA-Z]+\(|@[A-Z])/);
  return declaration + (next < 0 ? rest : rest.slice(0, next));
};

const OIDC_FILES = ['services/oidc-provider.service.ts', 'services/ever-id-session.service.ts', 'guards/oidc-sign-in-throttler.guard.ts'];

const OIDC_CONTROLLER_MEMBERS = [
  'private async signInWithOidc(',
  'async confirmOidcSignup(',
  'async connectIdentity(',
  'async confirmConnectIdentity(',
  'async listIdentities(',
  'async deleteIdentity(',
  'async backchannelLogout(',
  'private async verifyOidcCode(',
  'private async assertConnectable(',
  'private async signOidcUserToken(',
];

describe('Ever ID sign-in static checks', () => {
  const controller = read('controllers/auth.controller.ts');

  it('never decodes an Ever ID token without verifying it', () => {
    for (const declaration of OIDC_CONTROLLER_MEMBERS) {
      const body = member(controller, declaration);
      expect(body).not.toMatch(/jwtService\.decode|\.decode\(/);
    }
    for (const file of OIDC_FILES) {
      const source = read(file);
      expect(source).not.toMatch(/jwtService|JwtService|jsonwebtoken/);
      expect(source).not.toMatch(/[^a-zA-Z]decode\(/);
    }
    // The issuer of a token is read before verification only to pick the keys to verify it with
    const provider = read('services/oidc-provider.service.ts');
    expect(provider.match(/decodeJwt\(/g)).toHaveLength(1);
    expect(member(provider, 'private async verifyJwt(')).toContain('jwtVerify(');
  });

  it('builds no redirect on the Ever ID paths, so no token or email can end up in a URL', () => {
    for (const declaration of OIDC_CONTROLLER_MEMBERS) {
      expect(member(controller, declaration)).not.toMatch(/redirect\(|@Redirect|Location/i);
    }
    for (const file of OIDC_FILES) {
      expect(read(file)).not.toMatch(/\.redirect\(|@Redirect|'Location'/);
    }
  });

  it('never sends a login hint', () => {
    const webappAuth = join(src, '../../webapp/src/app/auth');
    const isSource = (name: string) => name.endsWith('.ts') && !name.endsWith('.spec.ts');
    const files = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
        if (entry.isDirectory()) {
          return files(join(dir, entry.name));
        }
        return isSource(entry.name) ? [join(dir, entry.name)] : [];
      });
    for (const file of [...files(webappAuth), ...OIDC_FILES.map(path => join(src, path)), join(src, 'controllers/auth.controller.ts')]) {
      expect(readFileSync(file, 'utf-8')).not.toContain('login_hint');
    }
  });

  it('logs no token, secret, verifier or sealed record', () => {
    const sources = [...OIDC_FILES.map(read), ...OIDC_CONTROLLER_MEMBERS.map(declaration => member(controller, declaration))];
    for (const source of sources) {
      const logCalls = source.match(/logger\.(?:log|warn|error|debug|verbose)\([^;]*\);/g) ?? [];
      for (const call of logCalls) {
        const interpolated = (call.match(/\$\{[^}]*\}/g) ?? []).join(' ');
        expect(interpolated).not.toMatch(/idToken|id_token|logoutToken|logout_token|clientSecret|codeVerifier|code_verifier|pending|payload\b/);
      }
    }
  });
});
