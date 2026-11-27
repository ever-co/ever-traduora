import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { EverInstance } from '../entity/ever-instance.entity';
import { EverAdminGuard } from './ever-admin.guard';
import { EverPlatformStatusController } from './ever-platform-status.controller';
import { EVER_INSTANCE_SETTINGS, readEverInstanceSettings } from './ever-instance.settings';
import { EverInstanceService } from './ever-instance.service';
import { OPERATOR_CHECK } from '../access/operator-check';

/**
 * The anonymous identity of this installation, the operator check and the status route the web app's menu reads.
 * Loaded only with the anonymous usage statistics or the Ever Platform connection (see `app.module.ts`); it makes no
 * outbound request.
 */
@Module({
  imports: [TypeOrmModule.forFeature([EverInstance])],
  controllers: [EverPlatformStatusController],
  providers: [
    { provide: EVER_INSTANCE_SETTINGS, useFactory: () => readEverInstanceSettings() },
    EverInstanceService,
    EverAdminGuard,
    // The check of the access guard's `operator` rule
    { provide: OPERATOR_CHECK, useExisting: EverInstanceService },
  ],
  exports: [EVER_INSTANCE_SETTINGS, EverInstanceService, EverAdminGuard, OPERATOR_CHECK],
})
export class EverInstanceModule {}
