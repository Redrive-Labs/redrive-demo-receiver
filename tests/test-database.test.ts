import { describe, expect, it } from "vitest";
import {
  assertTestDatabase,
  TEST_DATABASE_NAME,
} from "./test-database";

describe("test database safety", () => {
  it("allows only the dedicated test database", () => {
    expect(() => assertTestDatabase(TEST_DATABASE_NAME)).not.toThrow();
    expect(() => assertTestDatabase("receiver")).toThrow(
      "Refusing destructive test setup",
    );
    expect(() => assertTestDatabase(undefined)).toThrow(
      "Refusing destructive test setup",
    );
  });
});
