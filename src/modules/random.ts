import crypto from "node:crypto";

export const randomNumber = () => Math.random();

export const randomBytes = (length: number): Buffer =>
  crypto.randomBytes(length);

export const randomUUID = (): string => crypto.randomUUID();

export const randomInt = (min: number, max: number): number =>
  crypto.randomInt(min, max);

export const randomToken = (length?: number): string =>
  randomBytes(length ?? 32).toString("hex");
