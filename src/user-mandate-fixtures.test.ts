import { describe, expect, it } from "vitest";
import { evaluateUserMandateFixture, USER_MANDATE_FIXTURES } from "./user-mandate-fixtures.js";

describe("experimental user-mandate fixtures", () => {
  it("has stable, unique fixture identifiers", () => {
    const ids = USER_MANDATE_FIXTURES.map((fixture) => fixture.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  for (const fixture of USER_MANDATE_FIXTURES) {
    it(fixture.id, () => {
      expect(evaluateUserMandateFixture(fixture)).toEqual(fixture.expected);
    });
  }
});
