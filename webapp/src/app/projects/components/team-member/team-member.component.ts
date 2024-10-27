import { Component, EventEmitter, Input, Output } from '@angular/core';
import { ProjectRole } from '../../models/project-role';
import { ProjectUser } from '../../models/project-user';

@Component({
  selector: 'app-team-member',
  templateUrl: './team-member.component.html',
  styleUrls: ['./team-member.component.css'],
})
export class TeamMemberComponent {
  @Input()
  user: ProjectUser;

  @Input()
  canEdit = false;

  @Input()
  canDelete = false;

  @Output()
  edit = new EventEmitter<ProjectUser>();

  @Output()
  remove = new EventEmitter<ProjectUser>();

  projectRoles = [ProjectRole.Admin, ProjectRole.Editor, ProjectRole.Viewer];

  withRole(user: ProjectUser, role: ProjectRole): ProjectUser {
    user.role = role;
    return user;
  }
}
