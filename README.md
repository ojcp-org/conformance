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

## Contributing

See the [OJCP contributing guide](https://github.com/ojcp-org/ojcp/blob/main/CONTRIBUTING.md).

## License

Apache 2.0
