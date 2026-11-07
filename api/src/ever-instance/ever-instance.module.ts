import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { EverInstance } from '../entity/ever-instance.entity';
import { EverAdminGuard } from './ever-admin.guard';
import { EverInstanceService } from './ever-instance.service';

/**
 * The anonymous identity of this installation and the operator guard, shared by the optional Ever Platform features.
 * Loaded only with them (see `app.module.ts`); it makes no request of its own.
 */
@Module({
  imports: [TypeOrmModule.forFeature([EverInstance])],
  providers: [EverInstanceService, EverAdminGuard],
  exports: [EverInstanceService, EverAdminGuard],
})
export class EverInstanceModule {}
