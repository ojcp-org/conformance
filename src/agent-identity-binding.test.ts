import { describe, expect, it } from "vitest";
import {
  AGENT_IDENTITY_BINDING_FIXTURES,
  evaluateAgentIdentityBinding,
  evaluateAgentIdentityBindingFixture,
} from "./agent-identity-binding.js";

describe("agent identity binding fixtures (spec § Identity Binding)", () => {
  it("has stable, unique fixture identifiers", () => {
    const ids = AGENT_IDENTITY_BINDING_FIXTURES.map((fixture) => fixture.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  for (const fixture of AGENT_IDENTITY_BINDING_FIXTURES) {
    it(fixture.id, () => {
      expect(evaluateAgentIdentityBindingFixture(fixture)).toEqual(fixture.expected);
    });
  }

  it("fetches the document from the host the agent_id names, never the signer", () => {
    const fetched: string[] = [];
    evaluateAgentIdentityBinding({
      agentId: "com.acme.agent",
      signatureAgentOrigin: "https://acme.agentplatform.example",
      fetchIdentityDocument: (url) => {
        fetched.push(url);
        return null;
      },
    });
    expect(fetched).toEqual(["https://agent.acme.com/.well-known/ojcp-agent.json"]);
  });
});
