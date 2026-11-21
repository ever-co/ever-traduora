import { CommonModule } from '@angular/common';
import { NgModule } from '@angular/core';
import { RouterModule } from '@angular/router';
import { SharedModule } from '../shared/shared.module';
import { ConnectionComponent } from './components/connection/connection.component';
import { EverPlatformPageComponent } from './components/ever-platform-page/ever-platform-page.component';
import { MaintenanceComponent } from './components/maintenance/maintenance.component';
import { StatisticsComponent } from './components/statistics/statistics.component';

/** Ever Platform pages, for the operator of the installation (loaded on demand). */
@NgModule({
  declarations: [EverPlatformPageComponent, StatisticsComponent, ConnectionComponent, MaintenanceComponent],
  imports: [
    CommonModule,
    SharedModule,
    RouterModule.forChild([
      {
        path: '',
        component: EverPlatformPageComponent,
      },
    ]),
  ],
})
export class EverPlatformModule {}
