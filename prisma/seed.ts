// Seed values are documented here for the installation script to create through Prisma.
export const seedData = {
  pipelineStages: ["New", "Material Sent", "Demo Given", "Trial", "Booked", "Won", "Lost"],
  rejectionReasons: ["Poor Fit", "Closed", "Chain Decision", "Already Has Trivia", "Bad Contact Information", "Other"],
  roles: ["Administrator", "Manager", "Salesperson"],
  permissions: ["view_all_leads", "view_team_leads", "view_assigned_leads", "add_leads", "edit_leads", "delete_leads", "reassign_leads", "import_leads", "export_leads", "manage_users", "manage_prompts", "manage_competitors", "manage_settings", "restore_rejected"],
};
