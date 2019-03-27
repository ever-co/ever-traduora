import { ProjectRole } from '../../projects/models/project-role';

// WATCH OUT! Renaming the project actions can break this in the templates as they are not typed!
export enum ProjectAction {
  // Projects
  ViewProject,
  EditProject,
  DeleteProject,

  // Project Plan
  ViewProjectPlan,
  EditProjectPlan,

  // Project Users
  AddProjectUser,
  ViewProjectUsers,
  EditProjectUsers,
  DeleteProjectUsers,

  // Project Invites
  EditProjectInvites,
  DeleteProjectInvites,

  // Terms
  AddTerm,
  ViewTerm,
  EditTerm,
  DeleteTerm,

  // Translations
  AddTranslation,
  ViewTranslation,
  EditTranslation,
  DeleteTranslation,
  ImportTranslation,
  ExportTranslation,

  // Clients
  AddProjectClient,
  ViewProjectClients,
  EditProjectClients,
  DeleteProjectClients,
}

export const AllowedEditorActions = new Set([
  ProjectAction.ViewProject,
  ProjectAction.ViewProjectPlan,
  ProjectAction.ViewProjectUsers,
  ProjectAction.AddTerm,
  ProjectAction.ViewTerm,
  ProjectAction.EditTerm,
  ProjectAction.DeleteTerm,
  ProjectAction.AddTranslation,
  ProjectAction.ViewTranslation,
  ProjectAction.EditTranslation,
  ProjectAction.DeleteTranslation,
  ProjectAction.ImportTranslation,
  ProjectAction.ExportTranslation,
  ProjectAction.ViewProjectClients,
]);

export const AllowedViewerActions = new Set([
  ProjectAction.ViewProject,
  ProjectAction.ViewProjectPlan,
  ProjectAction.ViewProjectUsers,
  ProjectAction.ViewTerm,
  ProjectAction.ViewTranslation,
  ProjectAction.ExportTranslation,
  ProjectAction.ViewProjectClients,
]);

export function isAuthorized(role: ProjectRole, action: ProjectAction): boolean {
  switch (role) {
    // Authorize admins to every action
    case ProjectRole.Admin:
      return true;
    case ProjectRole.Editor:
      return AllowedEditorActions.has(action);
    case ProjectRole.Viewer:
      return AllowedViewerActions.has(action);
    default:
      return false;
  }
}
