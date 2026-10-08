import { describe, expect, it } from "vitest";
import {
  ATTRIBUTION_FIXTURES,
  attributableIdentity,
  evaluateAttributionFixture,
} from "./attribution.js";

describe("attribution fixtures (RFC 0007)", () => {
  it("has stable, unique fixture identifiers", () => {
    const ids = ATTRIBUTION_FIXTURES.map((fixture) => fixture.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  for (const fixture of ATTRIBUTION_FIXTURES) {
    it(fixture.id, () => {
      expect(evaluateAttributionFixture(fixture)).toEqual(fixture.expected);
    });
  }

  it("prefers a verified agent_id over a credential as the attributable identity", () => {
    expect(
      attributableIdentity({ verifiedAgentId: "ai.wayfarer.agent", credential: "key" }),
    ).toEqual({ kind: "verified_agent", id: "ai.wayfarer.agent" });
    expect(attributableIdentity({})).toBeNull();
  });
});
