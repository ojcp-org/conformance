/**
 * Reference evaluator and fixtures for OJCP agent identity binding — spec § Identity Binding,
 * as amended by RFC 0001 erratum E1 (https://github.com/ojcp-org/ojcp/issues/11).
 *
 * The inputs are facts an integration has already established: the HTTP signature verified
 * (spec § Verification steps 1–5) and the `Signature-Agent` origin it was verified against.
 * Signature verification stays the integration's job; this module decides only whether that
 * proven origin may speak for the declared `agent_id`.
 */

import Ajv2020 from "ajv/dist/2020.js";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const AGENT_IDENTITY_BINDING_FIXTURE_VERSION = "rfc-0001-e1";

export type AgentIdentityBindingFailure = "agent_id_malformed" | "agent_identity_mismatch";

/** Which rule bound the identifier: § Namespace Binding or § Delegated Binding. */
export type AgentIdentityBindingMechanism = "namespace" | "delegated";

export interface AgentIdentityDocument {
  agent_id: string;
  signers: string[];
}

export type AgentIdentityBindingResult =
  | { verified: true; mechanism: AgentIdentityBindingMechanism; documentFetched: boolean }
  | { verified: false; failure: AgentIdentityBindingFailure; documentFetched: boolean };

const IDENTITY_DOCUMENT_PATH = "/.well-known/ojcp-agent.json";

const schema = JSON.parse(
  readFileSync(
    resolve(dirname(fileURLToPath(import.meta.url)), "../schemas/agent-identity.json"),
    "utf8",
  ),
) as {
  properties: { agent_id: { pattern: string; maxLength: number } };
};

// The grammar comes from the vendored schema, so a spec change lands here with `pnpm sync-schemas`
// rather than being retyped.
const AGENT_ID_PATTERN = new RegExp(schema.properties.agent_id.pattern);
const AGENT_ID_MAX_LENGTH = schema.properties.agent_id.maxLength;

const validateDocument = new (Ajv2020 as any)({ strict: false }).compile(schema);

/** § Agent ID Grammar: lowercase LDH labels, at least two, at most 253 octets. Never normalized. */
export function isWellFormedAgentId(agentId: string): boolean {
  return agentId.length <= AGENT_ID_MAX_LENGTH && AGENT_ID_PATTERN.test(agentId);
}

/** The RFC 6454 ASCII serialization of an `https` origin, or null if `origin` is not one. */
export function serializeOrigin(origin: string): string | null {
  if (!URL.canParse(origin)) return null;
  const url = new URL(origin);
  return url.protocol === "https:" && url.hostname ? url.origin : null;
}

/**
 * The namespace an origin speaks for: its host's labels reversed (`agent.wayfarer.ai` →
 * `ai.wayfarer.agent`). Null for a non-https origin or an IP literal, which never bind.
 */
export function namespaceOf(signatureAgentOrigin: string): string | null {
  if (serializeOrigin(signatureAgentOrigin) === null) return null;
  const { hostname } = new URL(signatureAgentOrigin);
  // WHATWG URL has already canonicalized IPv4 forms (0x7f.1 → 127.0.0.1) and bracketed IPv6.
  if (hostname.startsWith("[") || /^\d+\.\d+\.\d+\.\d+$/.test(hostname)) return null;
  return hostname.split(".").reverse().join(".");
}

/** § Namespace Binding: the agent_id equals the namespace or sits beneath it on a label boundary. */
export function bindsByNamespace(agentId: string, signatureAgentOrigin: string): boolean {
  const namespace = namespaceOf(signatureAgentOrigin);
  return namespace !== null && (agentId === namespace || agentId.startsWith(`${namespace}.`));
}

/** § Delegated Binding: served by the host the agent_id names (`com.acme.agent` → `agent.acme.com`). */
export function identityDocumentUrl(agentId: string): string {
  return `https://${agentId.split(".").reverse().join(".")}${IDENTITY_DOCUMENT_PATH}`;
}

/**
 * Spec § Verification steps 6–7.
 *
 * @param fetchIdentityDocument returns the parsed body served at [identityDocumentUrl], or null
 *   when it is missing, unreachable or unparseable. Called at most once, and never when the
 *   namespace binding already holds.
 */
export function evaluateAgentIdentityBinding(input: {
  agentId: string;
  signatureAgentOrigin: string;
  fetchIdentityDocument: (url: string) => unknown;
}): AgentIdentityBindingResult {
  const { agentId, signatureAgentOrigin } = input;

  if (!isWellFormedAgentId(agentId)) {
    return { verified: false, failure: "agent_id_malformed", documentFetched: false };
  }
  if (bindsByNamespace(agentId, signatureAgentOrigin)) {
    return { verified: true, mechanism: "namespace", documentFetched: false };
  }

  const signer = serializeOrigin(signatureAgentOrigin);
  if (signer === null) {
    // Not an https origin, so nothing could have been verified against it.
    return { verified: false, failure: "agent_identity_mismatch", documentFetched: false };
  }

  const url = identityDocumentUrl(agentId);
  if (!URL.canParse(url)) {
    // A grammar-valid id can reverse to no usable hostname (`4.3.2.1.agent` → `agent.1.2.3.4`,
    // whose numeric final label no DNS name has). There is nothing to fetch, so no binding.
    return { verified: false, failure: "agent_identity_mismatch", documentFetched: false };
  }

  const document = input.fetchIdentityDocument(url);
  const authorized =
    document !== null &&
    validateDocument(document) === true &&
    (document as AgentIdentityDocument).agent_id === agentId &&
    (document as AgentIdentityDocument).signers.includes(signer);

  return authorized
    ? { verified: true, mechanism: "delegated", documentFetched: true }
    : { verified: false, failure: "agent_identity_mismatch", documentFetched: true };
}

export interface AgentIdentityBindingFixture {
  id: string;
  description: string;
  agentId: string;
  signatureAgentOrigin: string;
  /**
   * What the host named by `agentId` serves at `/.well-known/ojcp-agent.json`. Null when it serves
   * nothing usable. A fixture whose expected result has `documentFetched: false` must never read it.
   */
  identityDocument: unknown;
  expected: AgentIdentityBindingResult;
}

/** Runs a fixture, serving its `identityDocument` only from the URL the spec says to fetch. */
export function evaluateAgentIdentityBindingFixture(
  fixture: AgentIdentityBindingFixture,
): AgentIdentityBindingResult {
  return evaluateAgentIdentityBinding({
    agentId: fixture.agentId,
    signatureAgentOrigin: fixture.signatureAgentOrigin,
    fetchIdentityDocument: (url) =>
      url === identityDocumentUrl(fixture.agentId) ? fixture.identityDocument : null,
  });
}

const PLATFORM = "https://acme.agentplatform.example";

const NAMESPACE_OK = { verified: true, mechanism: "namespace", documentFetched: false } as const;
const DELEGATED_OK = { verified: true, mechanism: "delegated", documentFetched: true } as const;
const MISMATCH = {
  verified: false,
  failure: "agent_identity_mismatch",
  documentFetched: true,
} as const;
const MALFORMED = {
  verified: false,
  failure: "agent_id_malformed",
  documentFetched: false,
} as const;

function vector(
  id: string,
  description: string,
  agentId: string,
  signatureAgentOrigin: string,
  expected: AgentIdentityBindingResult,
  identityDocument: unknown = null,
): AgentIdentityBindingFixture {
  return { id, description, agentId, signatureAgentOrigin, identityDocument, expected };
}

export const AGENT_IDENTITY_BINDING_FIXTURES: AgentIdentityBindingFixture[] = [
  // § Namespace Binding — the spec's table, row by row.
  vector(
    "namespace-exact",
    "An origin binds the identifier its reversed host spells exactly.",
    "ai.wayfarer.agent",
    "https://agent.wayfarer.ai",
    NAMESPACE_OK,
  ),
  vector(
    "namespace-parent-vouches-for-child",
    "A host binds every identifier beneath its namespace.",
    "ai.wayfarer.agent",
    "https://wayfarer.ai",
    NAMESPACE_OK,
  ),
  vector(
    "namespace-child-cannot-claim-parent",
    "A subdomain cannot claim its parent's identifiers — the hole the PSL rule left open.",
    "ai.wayfarer.agent",
    "https://evil.wayfarer.ai",
    MISMATCH,
  ),
  vector(
    "namespace-sibling-tenant-cannot-claim",
    "A tenant of a shared host cannot claim a sibling tenant's identifiers, with no PSL lookup.",
    "io.github.bob.agent",
    "https://alice.github.io",
    MISMATCH,
  ),
  vector(
    "namespace-matches-on-label-boundary",
    "`ai.wayfarer` is not a prefix of `ai.wayfarerx.agent`.",
    "ai.wayfarerx.agent",
    "https://wayfarer.ai",
    MISMATCH,
  ),
  vector(
    "namespace-holds-without-fetch",
    "When the namespace binds, the document MUST NOT be fetched, whatever it would say.",
    "ai.wayfarer.agent",
    "https://agent.wayfarer.ai",
    NAMESPACE_OK,
    { agent_id: "ai.wayfarer.agent", signers: ["https://unrelated.example"] },
  ),
  vector(
    "namespace-hyphen-and-leading-digit",
    "Hostname labels may carry hyphens and leading digits.",
    "com.3m-health.agent",
    "https://3m-health.com",
    NAMESPACE_OK,
  ),
  vector(
    "namespace-ip-literal-never-binds",
    "An IP-literal origin speaks for no namespace, and `agent.1.2.3.4` is no host to fetch from.",
    "4.3.2.1.agent",
    "https://1.2.3.4",
    { verified: false, failure: "agent_identity_mismatch", documentFetched: false },
  ),

  // § Delegated Binding.
  vector(
    "delegated-signer-listed",
    "A third-party signer listed by the named host binds.",
    "com.acme.agent",
    PLATFORM,
    DELEGATED_OK,
    { agent_id: "com.acme.agent", signers: [PLATFORM] },
  ),
  vector(
    "delegated-origin-compared-serialized",
    "Origins compare by RFC 6454 serialization: case, trailing slash and default port do not matter.",
    "com.acme.agent",
    "https://ACME.agentplatform.example:443/",
    DELEGATED_OK,
    { agent_id: "com.acme.agent", signers: [PLATFORM] },
  ),
  vector(
    "delegated-port-is-part-of-the-origin",
    "A signer listed on another port is a different origin.",
    "com.acme.agent",
    PLATFORM,
    MISMATCH,
    { agent_id: "com.acme.agent", signers: [`${PLATFORM}:8443`] },
  ),
  vector(
    "delegated-signer-not-listed",
    "A document that does not list the signer does not bind it.",
    "com.acme.agent",
    PLATFORM,
    MISMATCH,
    { agent_id: "com.acme.agent", signers: ["https://other-platform.example"] },
  ),
  vector(
    "delegated-document-names-another-agent",
    "The document's agent_id must equal the presented one.",
    "com.acme.agent",
    PLATFORM,
    MISMATCH,
    { agent_id: "com.acme.other", signers: [PLATFORM] },
  ),
  vector(
    "delegated-document-missing",
    "A missing or unreachable document means the binding does not hold.",
    "com.acme.agent",
    PLATFORM,
    MISMATCH,
  ),
  vector(
    "delegated-document-invalid",
    "A document that fails the schema does not bind, even when it lists the signer.",
    "com.acme.agent",
    PLATFORM,
    MISMATCH,
    { agent_id: "com.acme.agent", signers: [PLATFORM, `${PLATFORM}/path`] },
  ),
  vector(
    "signer-cannot-self-declare",
    "Issue #11's first draft: an origin's own declaration is never consulted. Only the host the agent_id names can authorize a signer.",
    "ai.wayfarer.agent",
    "https://attacker.example",
    MISMATCH,
  ),
  vector(
    "migration-sibling-subdomain-unlisted",
    "A sibling-subdomain signer bound under the PSL rule and no longer binds by namespace.",
    "ai.wayfarer.agent",
    "https://keys.eu.wayfarer.ai",
    MISMATCH,
  ),
  vector(
    "migration-sibling-subdomain-listed",
    "The same signer binds once the named host lists it.",
    "ai.wayfarer.agent",
    "https://keys.eu.wayfarer.ai",
    DELEGATED_OK,
    { agent_id: "ai.wayfarer.agent", signers: ["https://keys.eu.wayfarer.ai"] },
  ),

  // § Agent ID Grammar — rejected before any binding is attempted, and never normalized.
  vector(
    "grammar-uppercase",
    "Uppercase is rejected, not folded.",
    "Ai.Wayfarer.agent",
    "https://wayfarer.ai",
    MALFORMED,
  ),
  vector(
    "grammar-underscore",
    "Underscores are not hostname characters.",
    "ai.wayfarer.my_agent",
    "https://wayfarer.ai",
    MALFORMED,
  ),
  vector(
    "grammar-single-label",
    "At least two labels are required.",
    "wayfarer",
    "https://wayfarer.ai",
    MALFORMED,
  ),
  vector(
    "grammar-u-label",
    "Internationalized labels appear only as A-labels.",
    "ai.bücher.agent",
    "https://xn--bcher-kva.ai",
    MALFORMED,
  ),
  vector(
    "grammar-trailing-dot",
    "An empty label is malformed.",
    "ai.wayfarer.agent.",
    "https://agent.wayfarer.ai",
    MALFORMED,
  ),
];
