import { Component, EventEmitter, Input, OnInit, Output } from '@angular/core';
import { ProjectClient } from '../../models/project-client';
import { ProjectRole } from '../../models/project-role';

@Component({
  selector: 'app-api-client',
  templateUrl: './api-client.component.html',
  styleUrls: ['./api-client.component.css'],
})
export class ApiClientComponent implements OnInit {
  @Input()
  projectClient: ProjectClient;

  @Input()
  canEdit = false;

  @Input()
  canDelete = false;

  @Output()
  edit = new EventEmitter<ProjectClient>();

  @Output()
  remove = new EventEmitter<ProjectClient>();

  projectRoles = [ProjectRole.Admin, ProjectRole.Editor, ProjectRole.Viewer];

  constructor() {}

  ngOnInit() {}

  withRole(user: ProjectClient, role: ProjectRole): ProjectClient {
    return { ...user, role: role };
  }

  copyToClipboard(text) {
    document.addEventListener('copy', (e: ClipboardEvent) => {
      e.clipboardData.setData('text/plain', text);
      e.preventDefault();
      document.removeEventListener('copy', null);
    });
    document.execCommand('copy');
  }
}
