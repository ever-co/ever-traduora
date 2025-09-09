import { ProjectRole } from './project-role';

export class ProjectClient {
  id: string;
  name: string;
  role: ProjectRole;
  secret?: string;
}
