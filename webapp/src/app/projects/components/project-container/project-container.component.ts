import { Component, OnDestroy, OnInit } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { Select, Store } from '@ngxs/store';
import { Observable } from 'rxjs';
import { Project } from '../../models/project';
import { ClearCurrentProject, ProjectsState, SetCurrentProject } from '../../stores/projects.state';

@Component({
  selector: 'app-project-container',
  templateUrl: './project-container.component.html',
  styleUrls: ['./project-container.component.css'],
})
export class ProjectContainerComponent implements OnInit, OnDestroy {
  @Select(ProjectsState.currentProject)
  project$: Observable<Project | undefined>;

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
