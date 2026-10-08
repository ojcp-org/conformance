# @ojcp/conformance

[![npm version](https://img.shields.io/npm/v/@ojcp/conformance)](https://www.npmjs.com/package/@ojcp/conformance)
[![CI](https://github.com/ojcp-org/conformance/actions/workflows/ci.yml/badge.svg)](https://github.com/ojcp-org/conformance/actions/workflows/ci.yml)
[![License: Apache 2.0](https://img.shields.io/badge/license-Apache%202.0-green)](https://www.apache.org/licenses/LICENSE-2.0)

Conformance test suite for [OJCP](https://ojcp.dev) (Open Job Context Protocol) implementations. Validates that a provider's manifest, job postings, and MCP tool responses conform to the [OJCP v0.1 specification](https://spec.ojcp.dev).

## Quick Start

Test a live endpoint:

```bash
npx @ojcp/conformance https://ojcp.dev
```

Output:

```
  OJCP Conformance Suite v0.1.0
  Target: https://ojcp.dev

  ✓ manifest-valid
  ✓ manifest-has-version
  ✓ manifest-has-tools
  ✓ manifest-has-search-jobs
  ✓ manifest-has-mcp-endpoint
  ✓ mcp-endpoint-reachable — Server: ojcp-reference-provider
  ✓ search-jobs-returns-jobs — 8 jobs returned
  ✓ search-jobs-valid-schema
  ✓ get-job-detail-returns-job
  ✓ begin-application-returns-session

  10 passed  0 failed  0 skipped
```

## Commands

### `test <url>`

Run the full conformance suite against a live OJCP endpoint.

```bash
npx @ojcp/conformance test https://careers.acme.com
npx @ojcp/conformance test https://ojcp.dev --json   # JSON output for CI
```

You can also pass a URL directly without `test`:

```bash
npx @ojcp/conformance https://ojcp.dev
```

### `validate <file>`

Validate a local JSON file against OJCP schemas.

```bash
npx @ojcp/conformance validate manifest.json
npx @ojcp/conformance validate job-posting.json --type job-posting
npx @ojcp/conformance validate ojcp-agent.json --type agent-identity
```

Auto-detects schema type from the JSON structure. Use `--type` to override.

## What It Tests

| Test | Description | When |
|------|-------------|------|
| `manifest-valid` | Manifest validates against OJCP JSON Schema | Always |
| `manifest-has-version` | `ojcp_version` is present | Always |
| `manifest-has-tools` | `tools` array is present | Always |
| `manifest-has-search-jobs` | `search_jobs` listed (REQUIRED per spec) | Always |
| `manifest-has-mcp-endpoint` | `mcp_endpoint` is declared | Always |
| `mcp-endpoint-reachable` | MCP endpoint responds to `initialize` | If declared |
| `search-jobs-returns-jobs` | `search_jobs` returns a `jobs` array | If MCP available |
| `search-jobs-valid-schema` | First job validates against JobPosting schema | If jobs returned |
| `get-job-detail-returns-job` | `get_job_detail` returns a job object | If tool declared |
| `begin-application-returns-session` | `begin_application` returns session | If tool declared |

## Programmatic API

```ts
import {
  validateManifest,
  validateJobPosting,
  validateCandidateContext,
  validateAgentDeclaration,
  validateVerificationProof,
  validateVerifierManifest,
  validateAgentIdentityDocument,
  validateToolResponse,
  runConformanceSuite,
} from "@ojcp/conformance";

// Validate a single object
const { valid, errors } = validateManifest(myManifest);

// Validate a tool response
const result = validateToolResponse("search-jobs", searchResponse);

// Run full suite against a live endpoint
const report = await runConformanceSuite("https://careers.acme.com");
console.log(`${report.passed} passed, ${report.failed} failed`);
```

### Types

```ts
interface ValidationResult {
  valid: boolean;
  errors: ValidationError[] | null;
}

interface ConformanceReport {
  target: string;
  passed: number;
  failed: number;
  skipped: number;
  results: TestResult[];
}
```

## CI Integration

Use `--json` for machine-readable output:

```bash
npx @ojcp/conformance test https://ojcp.dev --json
```

Exit code is `1` if any tests fail, `0` if all pass.

## Syncing Schemas

Schemas are vendored from [`ojcp-org/ojcp`](https://github.com/ojcp-org/ojcp). To update after a spec change:

```bash
pnpm sync-schemas
```

## Experimental user-mandate fixtures

`USER_MANDATE_FIXTURES` defines authorization decisions proposed by
[OJCP RFC 0003](https://github.com/ojcp-org/ojcp/pull/9): platform identity, candidate identity,
and user authorization are separate claims. The fixtures cover mandate absence, issuer admission,
agent-key binding, ATS and employer binding, candidate-data substitution, expiry, revocation, and
single-use replay.

They are deliberately **semantic fixtures**, not an SD-JWT VC implementation. An integration must
verify HTTP signatures, credential signatures, holder proof, and revocation data before passing
the corresponding facts to `evaluateUserMandateFixture`. This API and fixture set remain
experimental until RFC 0003 is accepted.

## Agent identity binding fixtures

`AGENT_IDENTITY_BINDING_FIXTURES` pins spec § Identity Binding as amended by
[RFC 0001 erratum E1](https://github.com/ojcp-org/ojcp/issues/11): whether a `Signature-Agent`
origin, already proven by an RFC 9421 signature, may speak for the declared `agent_id`.

- **Namespace binding** — the reversed host prefixes the `agent_id` on a label boundary
  (`wayfarer.ai` → `ai.wayfarer.*`). A subdomain cannot claim its parent's names; a tenant cannot
  claim a sibling's.
- **Delegated binding** — otherwise, the host the `agent_id` names serves
  `/.well-known/ojcp-agent.json` listing permitted signers. Never fetched when the namespace binds.
- **Grammar** — lowercase LDH labels, rejected with `agent_id_malformed`, never normalized.

`evaluateAgentIdentityBinding` is a reference implementation a provider can test against, with the
document fetch injected so the caller keeps its own SSRF-hardened client. Every result reports
`documentFetched`, so a provider that fetches when it must not is caught too. Signature
verification itself stays with the integration.

```ts
import { evaluateAgentIdentityBinding } from "@ojcp/conformance";

evaluateAgentIdentityBinding({
  agentId: "com.acme.agent",
  signatureAgentOrigin: "https://acme.agentplatform.example",
  fetchIdentityDocument: (url) => myHardenedFetchJson(url), // https://agent.acme.com/.well-known/ojcp-agent.json
});
// → { verified: true, mechanism: "delegated", documentFetched: true }
```

## Attribution fixtures

`ATTRIBUTION_FIXTURES` pins spec § Attribution ([RFC 0007](https://github.com/ojcp-org/ojcp/blob/main/docs/rfcs/0007-provider-derived-attribution.md)):
which evidence credits an application at `begin_application`.

- **Rule order** — a usable `attribution_ref`, then the caller's most recent impression of the job
  inside the attribution window (last touch, boundary inclusive), then none.
- **Attributable identity** — a verified `agent_id`, else a provider-issued credential. Anonymous
  and self-asserted callers are never matched by impression, only by reference.
- **References** — one that is forged, expired, or bound to another job counts as absent. One
  issued to another identity is credited as `referredBy`, and the caller's own impression is kept
  as `applyingImpressionId`.
- **Submit** — attribution fixed at begin is never replaced; a reference on `submit_application`
  applies only when begin found nothing.

`evaluateAttribution` is a reference implementation. The `attribution_ref` is opaque, so the
provider decodes and integrity-checks its own reference and passes the claims in.

```ts
import { evaluateAttribution } from "@ojcp/conformance";

evaluateAttribution({
  jobId: "careers.acme.com:swe-42091",
  now: "2026-10-08T12:00:00Z",
  windowDays: 30,
  caller: { verifiedAgentId: "ai.wayfarer.agent" },
  reference: null, // the agent relayed nothing
  impressions: [
    {
      id: "imp-1",
      identity: { kind: "verified_agent", id: "ai.wayfarer.agent" },
      ojcpId: "careers.acme.com:swe-42091",
      servedAt: "2026-10-07T12:00:00Z",
    },
  ],
});
// → { method: "impression_match", impressionId: "imp-1" }
```

## Contributing

See the [OJCP contributing guide](https://github.com/ojcp-org/ojcp/blob/main/CONTRIBUTING.md).

## License

Apache 2.0
