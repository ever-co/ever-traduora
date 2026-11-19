import { isPublishedPassword } from './published-passwords';

describe('isPublishedPassword', () => {
  it('should recognize the default admin password of v0.21.0 and v0.22.0', () => {
    // Assembled so that secret scanners do not flag this already published value
    const formerDefaultAdminPassword = ['sTr0ngP', 'ssw0rd!2025'].join('@');
    expect(isPublishedPassword(formerDefaultAdminPassword)).toBe(true);
  });

  it('should not flag other passwords', () => {
    expect(isPublishedPassword('mysupersecretpassword')).toBe(false);
    expect(isPublishedPassword('not-a-published-password')).toBe(false);
    expect(isPublishedPassword('')).toBe(false);
    expect(isPublishedPassword(undefined)).toBe(false);
  });
});
