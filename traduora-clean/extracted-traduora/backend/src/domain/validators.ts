export function normalizeEmail(email: string): string {
  const [user, rest] = email.split('@');
  return `${user}@${rest.toLowerCase()}`;
}
