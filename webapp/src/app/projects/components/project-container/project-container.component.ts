import { Component, OnDestroy, OnInit } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { Select, Store } from '@ngxs/store';
import { Observable } from 'rxjs';
import { Project } from '../../models/project';
import { ClearCurrentProject, ProjectsState, SetCurrentProject } from '../../stores/projects.state';
import { ProjectStats } from '../../models/project-stats';
import { map } from 'rxjs/operators';

@Component({
  selector: 'app-project-container',
  templateUrl: './project-container.component.html',
  styleUrls: ['./project-container.component.css'],
})
export class ProjectContainerComponent implements OnInit, OnDestroy {
  @Select(ProjectsState.currentProject)
  project$: Observable<Project | undefined>;

  @Select(ProjectsState.currentProjectStats)
  projectStats$!: Observable<ProjectStats | undefined>;

  projectProgress$ = this.projectStats$.pipe(
    map(v => {
      if (v) {
        return v.projectStats.progress;
      }
      return 0;
    }),
  );

  @Select(state => state.projects.isLoading)
  isLoading$: Observable<boolean>;

  shouldCollapse = true;

  constructor(private store: Store, private route: ActivatedRoute) {}

  toggleMenu() {
    this.shouldCollapse = !this.shouldCollapse;
  }

  ngOnInit() {
    const projectId = this.route.snapshot.paramMap.get('projectId');
    this.store.dispatch(new SetCurrentProject(projectId));
  }

  ngOnDestroy(): void {
    this.store.dispatch(new ClearCurrentProject());
  }
}
