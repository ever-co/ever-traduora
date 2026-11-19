import { ProjectRole } from './project-role';

export class ProjectInvite {
  id: string;
  email: string;
  role: ProjectRole;
  inviteUrl?: string;
}

// Inviting someone who already has an account adds them to the project directly
export interface ProjectInviteAddedUser {
  userId: string;
  name: string;
  email: string;
  role: ProjectRole;
}
