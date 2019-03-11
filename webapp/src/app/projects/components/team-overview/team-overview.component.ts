import { Component, OnDestroy, OnInit } from '@angular/core';
import { Select, Store } from '@ngxs/store';
import { sortBy } from 'lodash';
import { Observable, Subscription } from 'rxjs';
import { map, tap } from 'rxjs/operators';
import { Project } from '../../models/project';
import { ProjectRole } from '../../models/project-role';
import { ProjectUser } from '../../models/project-user';
import { GetProjectUsers, ProjectUserState as ProjectUsersState, RemoveProjectUser, UpdateProjectUser } from '../../stores/project-user.state';
import { ClearMessages, ProjectsState } from '../../stores/projects.state';

@Component({
  selector: 'app-team-overview',
  templateUrl: './team-overview.component.html',
  styleUrls: ['./team-overview.component.css'],
})
export class TeamOverviewComponent implements OnInit, OnDestroy {
  @Select(ProjectsState.currentProject)
  project$: Observable<Project | undefined>;

  @Select(ProjectUsersState.isLoading)
  isLoading$: Observable<boolean>;

  @Select(state => state.projectUsers.errorMessage)
  errorMessage$: Observable<string | undefined>;

  @Select(ProjectUsersState.users)
  _projectUsers$: Observable<ProjectUser[]>;

  projectUsers$: Observable<ProjectUser[]> = this._projectUsers$.pipe(map(users => sortBy(users, ['isSelf', 'email'])));

  private sub: Subscription;

  constructor(private store: Store) {}

  ngOnInit() {
    this.sub = this.project$.pipe(tap(project => this.store.dispatch(new GetProjectUsers(project.id)))).subscribe();
  }

  ngOnDestroy() {
    this.sub.unsubscribe();
    this.store.dispatch(new ClearMessages());
  }

  updateProjectUser(projectId: string, userId: string, role: ProjectRole) {
    this.store.dispatch(new UpdateProjectUser(projectId, userId, role));
  }

  removeProjectUser(projectId: string, userId: string) {
    if (confirm('Are you sure that you want to revoke access from this team member?')) {
      this.store.dispatch(new RemoveProjectUser(projectId, userId));
    }
  }
}
