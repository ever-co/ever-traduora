import { NotFoundException } from '@nestjs/common';
import { EverConnectProvisionEnabledGuard } from './ever-connect-provision.controller';
import { EverConnectProvisionService, returnAddress, sealTxn } from './ever-connect-provision.service';
import { PROVISION_TXN_MAX } from './ever-connect.dto';
import { EverConnectSettings } from './ever-connect.settings';

/** The service with only the settings it reads to decide whether its routes answer. */
const withSwitch = (provisionEnabled: boolean | undefined) =>
  new EverConnectProvisionService(null, null, null, { provisionEnabled } as EverConnectSettings, null, null, null);

describe('EverConnectProvisionEnabledGuard', () => {
  it('lets the provisioning routes answer only with TR_EVER_CONNECT_PROVISION_ENABLED=true', () => {
    expect(() => new EverConnectProvisionEnabledGuard(withSwitch(undefined)).canActivate()).toThrow(NotFoundException);
    expect(() => new EverConnectProvisionEnabledGuard(withSwitch(false)).canActivate()).toThrow(NotFoundException);
    expect(new EverConnectProvisionEnabledGuard(withSwitch(true)).canActivate()).toBe(true);
  });
});

describe('returnAddress', () => {
  it('keeps an absolute https address, and http on a local host only', () => {
    expect(returnAddress('https://app.ever.co/start/done?step=2')).toBe('https://app.ever.co/start/done?step=2');
    expect(returnAddress('http://localhost:4200/start')).toBe('http://localhost:4200/start');
    expect(returnAddress('http://app.ever.co/start')).toBeNull();
  });

  it('drops anything else', () => {
    for (const value of [
      undefined,
      null,
      '',
      '/start',
      'javascript:alert(1)',
      'https://user:pass@app.ever.co/',
      42,
      `https://a.test/${'x'.repeat(2100)}`,
    ]) {
      expect(returnAddress(value)).toBeNull();
    }
  });
});

describe('sealTxn', () => {
  it('keeps the largest confirmation the intent check allows under the length the routes take, JSON escaping included', () => {
    // Every field at its bound, made of the characters JSON.stringify writes longest (a control character: 6 bytes)
    const worst = (length: number) => String.fromCharCode(1).repeat(length);
    // Backslashes stay as they are in a query once normalized, and JSON writes each as two characters
    const prefix = 'https://app.ever.test/?q=';
    const returnTo = returnAddress(prefix + String.fromCharCode(92).repeat(2048 - prefix.length));
    expect(returnTo).not.toBeNull();
    const sealed = sealTxn(
      {
        jti: 'J'.repeat(64),
        sub: worst(255),
        org: { id: worst(64), handle: worst(64), displayName: worst(120) },
        returnTo,
        exp: 4102444800,
      },
      'unit-test-secret-of-this-installation',
      '01JMQCKINSTANCE0000000000A',
    );
    expect(sealed.length).toBeLessThan(PROVISION_TXN_MAX);
  });
});
