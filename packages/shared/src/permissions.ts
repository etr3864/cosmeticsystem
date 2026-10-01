export type Role = "super_admin" | "owner";

const TECHNICAL = new Set<Role>(["super_admin"]);

export function canSeeTechnical(role: Role): boolean {
  return TECHNICAL.has(role);
}

export function canWriteBusiness(role: Role): boolean {
  return role === "super_admin" || role === "owner";
}
