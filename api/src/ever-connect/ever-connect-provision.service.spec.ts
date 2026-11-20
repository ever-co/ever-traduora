import { NotFoundException } from '@nestjs/common';
import { EverConnectProvisionEnabledGuard } from './ever-connect-provision.controller';
import { EverConnectProvisionService, returnAddress } from './ever-connect-provision.service';
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
