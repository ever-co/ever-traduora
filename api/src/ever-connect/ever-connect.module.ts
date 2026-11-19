import { Logger, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { EverConnectAudit } from '../entity/ever-connect-audit.entity';
import { EverConnectConnection } from '../entity/ever-connect-connection.entity';
import { EverConnectIntegration } from '../entity/ever-connect-integration.entity';
import { EverInstanceModule } from '../ever-instance/ever-instance.module';
import { EverConnectAuditService } from './ever-connect-audit.service';
import { EVER_CONNECT_CLIENT_FACTORY, sdkPlatformClient } from './ever-connect-platform.client';
import { EVER_CONNECT_AUTOSTART, EverConnectSchedulerService } from './ever-connect-scheduler.service';
import { EverConnectController } from './ever-connect.controller';
import { EverConnectService } from './ever-connect.service';
import { EVER_CONNECT_SETTINGS, readEverConnectSettings } from './ever-connect.settings';

const logger = new Logger('EverConnectModule');

/**
 * The optional Ever Platform connection: connect this installation to an organization with a code, verified
 * entitlement documents, integrations consented in app.ever.co, and disconnect at any time. Loaded only with
 * `TR_EVER_CONNECT_ENABLED=true` (see `app.module.ts`); until an operator connects, it calls nothing. See
 * `docs/ever-platform/connection.md`.
 */
@Module({
  imports: [EverInstanceModule, TypeOrmModule.forFeature([EverConnectConnection, EverConnectIntegration, EverConnectAudit])],
  controllers: [EverConnectController],
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
    EverConnectSchedulerService,
  ],
  exports: [EVER_CONNECT_SETTINGS, EverConnectService],
})
export class EverConnectModule {}
