import { Component, EventEmitter, Input, Output } from '@angular/core';
import { ProjectRole } from '../../models/project-role';
import { ProjectInvite } from '../../models/project-invite';

@Component({
  selector: 'app-team-invite',
  templateUrl: './team-invite.component.html',
  styleUrls: ['./team-invite.component.css'],
})
export class TeamInviteComponent {
  @Input()
  invite: ProjectInvite;

  @Input()
  canEdit = false;

  @Input()
  canDelete = false;

  @Output()
  edit = new EventEmitter<ProjectInvite>();

  @Output()
  remove = new EventEmitter<ProjectInvite>();

  projectRoles = [ProjectRole.Admin, ProjectRole.Editor, ProjectRole.Viewer];

  withRole(invite: ProjectInvite, role: ProjectRole): ProjectInvite {
    return { ...invite, role: role };
  }
}
