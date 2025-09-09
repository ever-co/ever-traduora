import { ProjectRole } from './project-role';

export class ProjectUser {
  userId: string;
  name: string;
  email: string;
  role: ProjectRole;
  isSelf = false;
}
