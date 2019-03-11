import { Component, OnInit } from '@angular/core';
import { Select, Store } from '@ngxs/store';
import { Observable } from 'rxjs';
import { Project } from '../../models/project';
import { GetProjects, ProjectsState } from '../../stores/projects.state';

@Component({
  selector: 'app-project-list',
  templateUrl: './project-list.component.html',
  styleUrls: ['./project-list.component.css'],
})
export class ProjectListComponent implements OnInit {
  @Select(ProjectsState.projects)
  projects$: Observable<Project[]>;

  @Select(ProjectsState.isLoading)
  isLoading$: Observable<boolean>;

  constructor(private store: Store) {}

  ngOnInit() {
    this.store.dispatch(new GetProjects());
  }
}
