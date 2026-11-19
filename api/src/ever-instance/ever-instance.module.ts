import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { EverInstance } from '../entity/ever-instance.entity';
import { EverAdminGuard } from './ever-admin.guard';
import { EVER_INSTANCE_SETTINGS, readEverInstanceSettings } from './ever-instance.settings';
import { EverInstanceService } from './ever-instance.service';

/**
 * The anonymous identity of this installation and the operator check. Loaded only with the anonymous usage statistics
 * (see `app.module.ts`); it makes no outbound request.
 */
@Module({
  imports: [TypeOrmModule.forFeature([EverInstance])],
  providers: [{ provide: EVER_INSTANCE_SETTINGS, useFactory: () => readEverInstanceSettings() }, EverInstanceService, EverAdminGuard],
  exports: [EVER_INSTANCE_SETTINGS, EverInstanceService, EverAdminGuard],
})
export class EverInstanceModule {}
