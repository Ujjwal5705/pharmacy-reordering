import { PrismaClient } from "@prisma/client";

/**
 * Creates the dedicated test database if it does not exist yet, by connecting to the server's
 * built-in "postgres" maintenance database. Refuses any database not named pharmacy_test.
 */
export async function ensureTestDatabase(testUrl: string) {
  const url = new URL(testUrl);
  const name = url.pathname.replace(/^\//, "");
  if (name !== "pharmacy_test") throw new Error("Refusing to manage a database not named pharmacy_test.");
  url.pathname = "/postgres";
  const admin = new PrismaClient({ datasourceUrl: url.toString(), log: [] });
  try {
    const rows = await admin.$queryRaw<{ n: bigint }[]>`SELECT count(*)::bigint AS n FROM pg_database WHERE datname = ${name}`;
    if (Number(rows[0]?.n ?? 0) === 0) await admin.$executeRawUnsafe(`CREATE DATABASE "${name}"`);
  } finally {
    await admin.$disconnect();
  }
}
