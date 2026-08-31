import { Prisma } from "@prisma/client";

const UNREACHABLE_CODES = new Set(["P1001", "P1002", "P1017"]);

export function isDbUnreachableError(err: unknown): boolean {
  if (err instanceof Prisma.PrismaClientInitializationError) {
    return err.errorCode === undefined || UNREACHABLE_CODES.has(err.errorCode);
  }
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    return UNREACHABLE_CODES.has(err.code);
  }
  return false;
}
