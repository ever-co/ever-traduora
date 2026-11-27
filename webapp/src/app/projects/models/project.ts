import { Plan } from './plan';

export interface Project {
  id: string;
  name: string;
  description?: string;
  role: string;
  termsCount: number;
  localesCount: number;
  /** The organization the project belongs to */
  organizationId?: string;
  plan?: Plan;
}
