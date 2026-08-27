export const TEST_DATABASE_NAME = "receiver_test";

export function assertTestDatabase(databaseName: string | undefined): void {
  if (databaseName !== TEST_DATABASE_NAME) {
    throw new Error(
      `Refusing destructive test setup: PGDATABASE must be ${TEST_DATABASE_NAME}`,
    );
  }
}
