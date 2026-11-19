import { CommonModule } from '@angular/common';
import { NgModule } from '@angular/core';
import { RouterModule } from '@angular/router';
import { SharedModule } from '../shared/shared.module';
import { StatisticsComponent } from './components/statistics/statistics.component';

/** Ever Platform pages, for the operator of the installation (loaded on demand). */
@NgModule({
  declarations: [StatisticsComponent],
  imports: [
    CommonModule,
    SharedModule,
    RouterModule.forChild([
      {
        path: '',
        component: StatisticsComponent,
      },
    ]),
  ],
})
export class EverPlatformModule {}
