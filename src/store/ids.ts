import { customAlphabet } from "nanoid";

const alphabet = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
const nano = customAlphabet(alphabet, 12);

export function newId(): string {
  return nano();
}

export function nowIso(): string {
  return new Date().toISOString();
}
