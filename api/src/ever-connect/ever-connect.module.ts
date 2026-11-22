import { Logger, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { EverConnectAudit } from '../entity/ever-connect-audit.entity';
import { EverConnectConnection } from '../entity/ever-connect-connection.entity';
import { EverConnectIntegration } from '../entity/ever-connect-integration.entity';
import { EverConnectManagedOperation } from '../entity/ever-connect-managed-operation.entity';
import { EverConnectManagedPolicy } from '../entity/ever-connect-managed-policy.entity';
import { EverConnectPersonExport } from '../entity/ever-connect-person-export.entity';
import { EverConnectPersonLink } from '../entity/ever-connect-person-link.entity';
import { EverConnectPersonRequest } from '../entity/ever-connect-person-request.entity';
import { EverConnectProvision } from '../entity/ever-connect-provision.entity';
import { UserIdentity } from '../entity/user-identity.entity';
import { EverInstanceModule } from '../ever-instance/ever-instance.module';
import { EverConnectAuditService } from './ever-connect-audit.service';
import { EverConnectManagedService } from './ever-connect-managed.service';
import { EverConnectPersonController, EverSignedInUserGuard } from './ever-connect-person.controller';
import { EverConnectPersonService } from './ever-connect-person.service';
import { EVER_CONNECT_CLIENT_FACTORY, sdkPlatformClient } from './ever-connect-platform.client';
import { EverConnectProvisionController, EverConnectProvisionEnabledGuard } from './ever-connect-provision.controller';
import { EverConnectProvisionService } from './ever-connect-provision.service';
import { EVER_CONNECT_AUTOSTART, EverConnectSchedulerService } from './ever-connect-scheduler.service';
import { EverConnectController } from './ever-connect.controller';
import { EverConnectService } from './ever-connect.service';
import { EVER_CONNECT_SETTINGS, readEverConnectSettings } from './ever-connect.settings';

const logger = new Logger('EverConnectModule');

/**
 * The optional Ever Platform connection: connect this installation to an organization with a code, verified
 * entitlement documents, integrations consented in app.ever.co, a person's deletion and export requests and person
 * links, maintenance operations the operator opted in to, provisioning handed off from app.ever.co (with
 * `TR_EVER_CONNECT_PROVISION_ENABLED=true`), and disconnect at any time. Loaded only with
 * `TR_EVER_CONNECT_ENABLED=true` (see `app.module.ts`); until an operator connects, it calls nothing. See
 * `docs/ever-platform/connection.md`.
 */
@Module({
  imports: [
    EverInstanceModule,
    TypeOrmModule.forFeature([
      EverConnectConnection,
      EverConnectIntegration,
      EverConnectAudit,
      EverConnectPersonLink,
      EverConnectPersonRequest,
      EverConnectPersonExport,
      EverConnectManagedPolicy,
      EverConnectManagedOperation,
      EverConnectProvision,
      // A person's requests and links read the accounts' Ever IDs (and, for an export, the account's own data)
      UserIdentity,
    ]),
  ],
  controllers: [EverConnectController, EverConnectPersonController, EverConnectProvisionController],
  providers: [
    {
      provide: EVER_CONNECT_SETTINGS,
      useFactory: () => {
        const settings = readEverConnectSettings();
        if (!settings.apiUrl) {
          logger.warn('ever_connect state=no_destination: TR_EVER_PLATFORM_API_URL cannot be used, nothing will be called.');
        }
        return settings;
      },
    },
    { provide: EVER_CONNECT_CLIENT_FACTORY, useValue: sdkPlatformClient },
    { provide: EVER_CONNECT_AUTOSTART, useValue: true },
    EverConnectAuditService,
    EverConnectService,
    EverConnectPersonService,
    EverConnectManagedService,
    EverConnectProvisionService,
    EverConnectProvisionEnabledGuard,
    EverSignedInUserGuard,
    EverConnectSchedulerService,
  ],
  exports: [EVER_CONNECT_SETTINGS, EverConnectService],
})
export class EverConnectModule {}
