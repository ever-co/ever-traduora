import { NotFoundException } from '@nestjs/common';
import { EverConnectProvisionEnabledGuard } from './ever-connect-provision.controller';
import { auditEntry, EverConnectProvisionService, returnAddress, sealTxn } from './ever-connect-provision.service';
import { PROVISION_TXN_MAX } from './ever-connect.dto';
import { EverConnectSettings } from './ever-connect.settings';

/** The service with only the settings it reads to decide whether its routes answer. */
const withSwitch = (provisionEnabled: boolean | undefined) =>
  new EverConnectProvisionService(null, null, null, { provisionEnabled } as EverConnectSettings, null, null, null, null);

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

describe('the audit row of a provisioning answer', () => {
  const settings = { provisionEnabled: true } as EverConnectSettings;
  const row = { jti: 'j1', state: 'created', userId: 'u1', projectId: 'p1', audited: false, auditClaimedAt: null };

  /** The service over stand-ins: the answers of the provision table, the audit rows already there, the audit writer. */
  const build = (options: { findOne?: jest.Mock; claims?: number[]; written?: number; record?: jest.Mock; stillMine?: boolean }) => {
    const claims = [...(options.claims ?? [1])];
    const provisions = {
      findOne: options.findOne ?? jest.fn().mockResolvedValue(row),
      // The claim updates (on an empty or a stale claim) answer from `claims`; every other update changes the row
      update: jest.fn().mockImplementation(async (criteria: Record<string, unknown>) => ({
        affected: 'auditClaimedAt' in criteria && typeof criteria.auditClaimedAt !== 'number' ? (claims.shift() ?? 0) : 1,
      })),
      // Whether the claim is still this caller's right before the write
      count: jest.fn().mockResolvedValue(options.stillMine === false ? 0 : 1),
    };
    const auditRows = { count: jest.fn().mockResolvedValue(options.written ?? 0) };
    const audit = { record: options.record ?? jest.fn().mockResolvedValue(undefined) };
    const service = new EverConnectProvisionService(provisions as never, null, null, settings, null, null, audit as never, auditRows as never);
    return { service, provisions, audit, recordAudit: () => (service as any).recordAudit('j1') };
  };

  it('writes the row once, naming the intent, then sets the flag', async () => {
    const { recordAudit, audit, provisions } = build({});
    await expect(recordAudit()).resolves.toBeUndefined();
    expect(audit.record).toHaveBeenCalledWith('provision.created', 'user:u1', 'project=p1 jti=j1');
    expect(provisions.update).toHaveBeenLastCalledWith({ jti: 'j1', auditClaimedAt: expect.any(Number) }, { audited: true, auditClaimedAt: null });
  });

  it('writes nothing when its claim went stale and another caller took it before the write', async () => {
    const { recordAudit, audit } = build({ stillMine: false });
    await recordAudit();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('never releases a claim it does not hold', async () => {
    // The read fails before any claim: nothing is released
    const { recordAudit, provisions } = build({ findOne: jest.fn().mockRejectedValue(new Error('database gone')) });
    await recordAudit();
    expect(provisions.update).not.toHaveBeenCalled();
  });

  it('writes nothing while another caller holds a fresh claim', async () => {
    const { recordAudit, audit } = build({ claims: [0, 0] });
    await recordAudit();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('takes an interrupted claim again once it is stale, without writing the row twice', async () => {
    // The fresh claim fails (held), the stale one succeeds; the row was written before the interruption
    const { recordAudit, audit, provisions } = build({ claims: [0, 1], written: 1 });
    await recordAudit();
    expect(audit.record).not.toHaveBeenCalled();
    expect(provisions.update).toHaveBeenLastCalledWith({ jti: 'j1', auditClaimedAt: expect.any(Number) }, { audited: true, auditClaimedAt: null });
  });

  it('never fails the answer: a failed read or write is left for the background round', async () => {
    const unreadable = build({ findOne: jest.fn().mockRejectedValue(new Error('database gone')) });
    await expect(unreadable.recordAudit()).resolves.toBeUndefined();
    expect(unreadable.audit.record).not.toHaveBeenCalled();

    const unwritable = build({ record: jest.fn().mockRejectedValue(new Error('audit full')) });
    await expect(unwritable.recordAudit()).resolves.toBeUndefined();
    // Its own claim is released for the next round, and the flag is not set
    expect(unwritable.provisions.update).toHaveBeenLastCalledWith(
      { jti: 'j1', audited: false, auditClaimedAt: expect.any(Number) },
      { auditClaimedAt: null },
    );
  });

  it('names the intent in every entry, with ids only', () => {
    expect(auditEntry({ jti: 'j2', state: 'refused', userId: null, projectId: null })).toEqual({
      action: 'provision.refused',
      actorRef: 'system',
      detail: 'jti=j2',
    });
  });
});
