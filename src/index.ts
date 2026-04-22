import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { readFileSync, readdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCHEMAS_DIR = resolve(__dirname, "../schemas");

const FETCH_TIMEOUT_MS = 15_000;

function loadSchema(relativePath: string): Record<string, unknown> {
  return JSON.parse(readFileSync(resolve(SCHEMAS_DIR, relativePath), "utf8"));
}

// Shared AJV instance with all schemas pre-loaded for $ref resolution
let _ajv: any = null;

function getValidator() {
  if (_ajv) return _ajv;
  const ajv = new (Ajv2020 as any)({ strict: false, allErrors: true });
  (addFormats as any)(ajv);

  // Register all top-level schemas
  for (const file of readdirSync(SCHEMAS_DIR)) {
    if (file.endsWith(".json")) ajv.addSchema(loadSchema(file));
  }
  // Register response schemas
  const responsesDir = resolve(SCHEMAS_DIR, "responses");
  for (const file of readdirSync(responsesDir)) {
    if (file.endsWith(".json")) ajv.addSchema(loadSchema(`responses/${file}`));
  }

  _ajv = ajv;
  return ajv;
}

// ── Types ──

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[] | null;
}

export interface ValidationError {
  instancePath: string;
  message: string;
  schemaPath?: string;
  keyword?: string;
  params?: Record<string, unknown>;
}

export interface TestResult {
  test: string;
  status: "passed" | "failed" | "skipped";
  message?: string;
  errors?: ValidationError[];
}

export interface ConformanceReport {
  target: string;
  passed: number;
  failed: number;
  skipped: number;
  results: TestResult[];
}

const VALID_TOOL_RESPONSE_TYPES = new Set([
  "search-jobs",
  "job-detail",
  "employer-context",
  "begin-application",
  "submit-application",
  "application-status",
  "error",
]);

export type ToolResponseType =
  | "search-jobs"
  | "job-detail"
  | "employer-context"
  | "begin-application"
  | "submit-application"
  | "application-status"
  | "error";

// ── Validators ──

function validate(schemaPath: string, data: unknown): ValidationResult {
  const ajv = getValidator();
  const schema = loadSchema(schemaPath);
  const schemaId = schema.$id as string | undefined;

  // If schema is already registered (by $id), validate by reference to avoid duplicate registration
  if (schemaId && ajv.getSchema(schemaId)) {
    const valid = ajv.validate(schemaId, data) as boolean;
    return { valid, errors: ajv.errors as ValidationError[] | null };
  }

  const valid = ajv.validate(schema, data) as boolean;
  return { valid, errors: ajv.errors as ValidationError[] | null };
}

export function validateManifest(manifest: unknown): ValidationResult {
  return validate("manifest.json", manifest);
}

export function validateJobPosting(jobPosting: unknown): ValidationResult {
  return validate("job-posting.json", jobPosting);
}

export function validateCandidateContext(context: unknown): ValidationResult {
  return validate("candidate-context.json", context);
}

export function validateAgentDeclaration(declaration: unknown): ValidationResult {
  return validate("agent-declaration.json", declaration);
}

export function validateVerificationProof(proof: unknown): ValidationResult {
  return validate("verification-proof.json", proof);
}

export function validateVerifierManifest(manifest: unknown): ValidationResult {
  return validate("verifier-manifest.json", manifest);
}

export function validateToolResponse(tool: ToolResponseType, response: unknown): ValidationResult {
  if (!VALID_TOOL_RESPONSE_TYPES.has(tool)) {
    throw new Error(`Invalid tool response type: ${tool}`);
  }
  return validate(`responses/${tool}.json`, response);
}

// ── MCP helpers ──

const MCP_HEADERS = {
  "Content-Type": "application/json",
  Accept: "application/json, text/event-stream",
};

function parseSSEOrJSON(text: string): Record<string, unknown> | null {
  if (text.startsWith("event:") || text.startsWith("data:")) {
    // Take the last data line — SSE streams may have multiple events
    const dataLines = text.split("\n").filter((l) => l.startsWith("data:"));
    const lastData = dataLines[dataLines.length - 1];
    return lastData ? JSON.parse(lastData.slice(5).trim()) : null;
  }
  return JSON.parse(text);
}

function fetchWithTimeout(url: string, init?: RequestInit): Promise<Response> {
  return fetch(url, {
    ...init,
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
}

async function mcpCall(
  endpoint: string,
  id: number,
  method: string,
  params: unknown,
): Promise<Record<string, unknown> | null> {
  const res = await fetchWithTimeout(endpoint, {
    method: "POST",
    headers: MCP_HEADERS,
    body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
  });
  return parseSSEOrJSON(await res.text());
}

function extractToolResult(body: Record<string, unknown> | null): Record<string, unknown> | null {
  const result = body?.result as Record<string, unknown> | undefined;
  const content = (result?.content as Array<{ text: string }>)?.[0];
  return content?.text ? JSON.parse(content.text) : null;
}

// ── Conformance Suite ──

export async function runConformanceSuite(baseUrl: string): Promise<ConformanceReport> {
  if (!URL.canParse(baseUrl)) {
    throw new Error(`Invalid URL: ${baseUrl}`);
  }

  const results: TestResult[] = [];
  let passed = 0;
  let failed = 0;
  let skipped = 0;

  const pass = (test: string, message?: string) => {
    results.push({ test, status: "passed", message });
    passed++;
  };
  const fail = (test: string, message?: string, errors?: ValidationError[]) => {
    results.push({ test, status: "failed", message, errors });
    failed++;
  };
  const skip = (test: string, message?: string) => {
    results.push({ test, status: "skipped", message });
    skipped++;
  };

  // ── 1. Fetch and validate manifest ──
  const manifestUrl = `${baseUrl.replace(/\/$/, "")}/.well-known/ojcp.json`;
  let manifest: Record<string, unknown>;
  try {
    const res = await fetchWithTimeout(manifestUrl);
    if (!res.ok) {
      fail("manifest-fetch", `HTTP ${res.status} from ${manifestUrl}`);
      return { target: baseUrl, passed, failed, skipped, results };
    }
    manifest = (await res.json()) as Record<string, unknown>;
    const v = validateManifest(manifest);
    v.valid ? pass("manifest-valid") : fail("manifest-valid", undefined, v.errors ?? undefined);
  } catch (err) {
    fail("manifest-fetch", (err as Error).message);
    return { target: baseUrl, passed, failed, skipped, results };
  }

  // ── 2. Required fields ──
  manifest.ojcp_version
    ? pass("manifest-has-version")
    : fail("manifest-has-version", "Missing ojcp_version");

  const tools = manifest.tools as string[] | undefined;
  tools && Array.isArray(tools)
    ? pass("manifest-has-tools")
    : fail("manifest-has-tools", "Missing or invalid tools array");

  tools?.includes("search_jobs")
    ? pass("manifest-has-search-jobs")
    : fail("manifest-has-search-jobs", "search_jobs is REQUIRED but not listed in tools");

  // ── 3. MCP endpoint ──
  const mcpEndpoint = manifest.mcp_endpoint as string | undefined;
  mcpEndpoint
    ? pass("manifest-has-mcp-endpoint")
    : skip("manifest-has-mcp-endpoint", "No mcp_endpoint declared");

  // ── 4. Probe MCP endpoint ──
  if (mcpEndpoint) {
    try {
      const body = await mcpCall(mcpEndpoint, 1, "initialize", {
        protocolVersion: "2025-03-26",
        capabilities: {},
        clientInfo: { name: "ojcp-conformance", version: "0.1.0" },
      });
      const result = body?.result as Record<string, unknown> | undefined;
      const serverInfo = result?.serverInfo as Record<string, unknown> | undefined;
      serverInfo
        ? pass("mcp-endpoint-reachable", `Server: ${serverInfo.name}`)
        : fail("mcp-endpoint-reachable", "Unexpected response");
    } catch (err) {
      fail("mcp-endpoint-reachable", (err as Error).message);
    }
  }

  // Cache job ID to avoid redundant search calls
  let cachedJobId: string | null | undefined;
  async function getFirstJobId(): Promise<string | null> {
    if (cachedJobId !== undefined) return cachedJobId;
    if (!mcpEndpoint) return (cachedJobId = null);
    const body = await mcpCall(mcpEndpoint, 10, "tools/call", {
      name: "search_jobs",
      arguments: { query: "engineer", pagination: { limit: 1 } },
    });
    const data = extractToolResult(body);
    cachedJobId = (data as any)?.jobs?.[0]?.ojcp_id ?? null;
    return cachedJobId!;
  }

  // ── 5. search_jobs ──
  if (mcpEndpoint && tools?.includes("search_jobs")) {
    try {
      const body = await mcpCall(mcpEndpoint, 2, "tools/call", {
        name: "search_jobs",
        arguments: { query: "engineer" },
      });
      const data = extractToolResult(body);
      const jobs = (data as any)?.jobs;
      if (Array.isArray(jobs)) {
        pass("search-jobs-returns-jobs", `${jobs.length} jobs returned`);
        if (jobs.length > 0) {
          const v = validateJobPosting(jobs[0]);
          v.valid
            ? pass("search-jobs-valid-schema")
            : fail("search-jobs-valid-schema", undefined, v.errors ?? undefined);
        }
      } else {
        fail("search-jobs-returns-jobs", "Response missing jobs array");
      }
    } catch (err) {
      fail("search-jobs-returns-jobs", (err as Error).message);
    }
  }

  // ── 6. get_job_detail ──
  if (mcpEndpoint && tools?.includes("get_job_detail")) {
    try {
      const jobId = await getFirstJobId();
      if (jobId) {
        const body = await mcpCall(mcpEndpoint, 4, "tools/call", {
          name: "get_job_detail",
          arguments: { job_id: jobId },
        });
        const detail = extractToolResult(body);
        (detail as any)?.job
          ? pass("get-job-detail-returns-job")
          : fail("get-job-detail-returns-job", "Response missing job object");
      } else {
        skip("get-job-detail-returns-job", "No jobs to test against");
      }
    } catch (err) {
      fail("get-job-detail-returns-job", (err as Error).message);
    }
  }

  // ── 7. begin_application ──
  if (mcpEndpoint && tools?.includes("begin_application")) {
    try {
      const jobId = await getFirstJobId();
      if (jobId) {
        const body = await mcpCall(mcpEndpoint, 6, "tools/call", {
          name: "begin_application",
          arguments: { job_id: jobId },
        });
        const app = extractToolResult(body);
        (app as any)?.application_id && (app as any)?.session_token
          ? pass("begin-application-returns-session")
          : fail("begin-application-returns-session", "Missing application_id or session_token");
      } else {
        skip("begin-application-returns-session", "No jobs to test against");
      }
    } catch (err) {
      fail("begin-application-returns-session", (err as Error).message);
    }
  }

  return { target: baseUrl, passed, failed, skipped, results };
}
