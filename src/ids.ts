import { randomBytes, randomUUID } from "node:crypto";

export function createId(prefix: string): string {
  return `${prefix}_${randomUUID().replaceAll("-", "")}`;
}

export function createToken(): string {
  return `ah_${randomBytes(32).toString("base64url")}`;
}

export function createShortSuffix(): string {
  return randomBytes(3).toString("hex");
}

export function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}
