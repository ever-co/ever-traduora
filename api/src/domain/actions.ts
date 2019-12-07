export enum ProjectAction {
  // Projects
  ViewProject,
  EditProject,
  DeleteProject,

  // Project Plan
  ViewProjectPlan,
  EditProjectPlan,

  // Project Users
  InviteProjectUser,
  ViewProjectUsers,
  EditProjectUsers,
  DeleteProjectUsers,

  // Project Invites
  ViewProjectInvites,
  EditProjectInvites,
  DeleteProjectInvites,

  // Terms
  AddTerm,
  ViewTerm,
  EditTerm,
  DeleteTerm,

  // Tags
  AddTags,
  ViewTags,
  EditTags,
  DeleteTags,

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
  ProjectAction.ViewProjectInvites,
  ProjectAction.AddTerm,
  ProjectAction.ViewTerm,
  ProjectAction.EditTerm,
  ProjectAction.DeleteTerm,
  ProjectAction.AddTags,
  ProjectAction.ViewTags,
  ProjectAction.EditTags,
  ProjectAction.DeleteTags,
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
  ProjectAction.ViewProjectInvites,
  ProjectAction.ViewTerm,
  ProjectAction.ViewTags,
  ProjectAction.ViewTranslation,
  ProjectAction.ExportTranslation,
  ProjectAction.ViewProjectClients,
]);
