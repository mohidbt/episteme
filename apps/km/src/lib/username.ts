import { RESERVED } from "./reserved-usernames";

export { RESERVED };

export function isReservedUsername(name: string): boolean {
  return RESERVED.has(name.toLowerCase());
}

export function isValidUsername(name: string): boolean {
  return /^[a-z0-9-]{3,30}$/.test(name) && !isReservedUsername(name);
}
