import { Component, OnDestroy, OnInit } from '@angular/core';
import { Select, Store } from '@ngxs/store';
import { Observable, Subscription } from 'rxjs';
import { tap } from 'rxjs/operators';
import { Project } from '../../models/project';
import { ProjectClient } from '../../models/project-client';
import { ProjectRole } from '../../models/project-role';
import { ClearMessages, GetProjectClients, ProjectClientState, RemoveProjectClient, UpdateProjectClient } from '../../stores/project-client.state';
import { ProjectsState } from '../../stores/projects.state';

@Component({
  selector: 'app-api-clients-overview',
  templateUrl: './api-clients-overview.component.html',
  styleUrls: ['./api-clients-overview.component.css'],
})
export class ApiClientsOverviewComponent implements OnInit, OnDestroy {
  @Select(ProjectsState.currentProject)
  project$: Observable<Project | undefined>;

  @Select(ProjectClientState.isLoading)
  isLoading$: Observable<boolean>;

  @Select(state => state.projectUsers.errorMessage)
  errorMessage$: Observable<string | undefined>;

  @Select(ProjectClientState.clients)
  projectClients$: Observable<ProjectClient[]>;

  private sub: Subscription;

  constructor(private store: Store) {}

  ngOnInit() {
    this.sub = this.project$.pipe(tap(project => this.store.dispatch(new GetProjectClients(project.id)))).subscribe();
  }

  ngOnDestroy() {
    this.sub.unsubscribe();
    this.store.dispatch(new ClearMessages());
  }

  updateProjectClient(projectId: string, clientId: string, role: ProjectRole) {
    this.store.dispatch(new UpdateProjectClient(projectId, clientId, role));
  }

  removeProjectClient(projectId: string, clientId: string) {
    if (confirm('Are you sure that you want to revoke access from this API client?')) {
      this.store.dispatch(new RemoveProjectClient(projectId, clientId));
    }
  }
}
