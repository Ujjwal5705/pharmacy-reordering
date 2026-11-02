export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? "postgresql://pharmacy:pharmacy_local_dev@localhost:5433/pharmacy_test?schema=public";
