import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { runConformanceSuite, type ConformanceReport } from "./index.js";

type CandidateContext = Record<string, unknown> & { consent_scope: string };
type Job = Record<string, unknown>;

/** What the stub provider does with the candidate context on a `search_jobs` call. */
interface ProviderBehavior {
  /** Return a tool error when `candidate_context` is present at all. */
  rejectCandidateContext?: boolean;
  /** Return a tool error when the context carries a field beyond its declared scope. */
  rejectOverScope?: boolean;
  /** Return a `fields_ignored` warning for a dropped field. */
  warnOnIgnoredField?: boolean;
  /** Score results even when no candidate context was sent. */
  scoreAnonymousSearch?: boolean;
  /** The `fit_score` given to the first result; `null` returns no scores at all. */
  fitScore?: number | null;
  /** Leave `fit_rationale` off scored results. */
  omitRationale?: boolean;
}

const JOBS: Job[] = [
  {
    ojcp_id: "acme:swe-001",
    title: "Software Engineer",
    employer: { name: "Acme Corp" },
    datePosted: "2026-03-01",
  },
  {
    ojcp_id: "acme:swe-002",
    title: "Data Engineer",
    employer: { name: "Acme Corp" },
    datePosted: "2026-03-02",
  },
];

function search(args: { candidate_context?: CandidateContext }, behavior: ProviderBehavior) {
  const context = args.candidate_context;
  const overScope = context !== undefined && "name" in context;
  if (context && behavior.rejectCandidateContext) {
    return { error: "Invalid arguments: candidate_context is a disallowed additional property" };
  }
  if (overScope && behavior.rejectOverScope) {
    return { error: "Invalid arguments: name is not permitted at consent_scope fit_scoring" };
  }

  const first = behavior.fitScore === undefined ? 0.8 : behavior.fitScore;
  const scored = first !== null && (context !== undefined || behavior.scoreAnonymousSearch);
  const jobs = JOBS.map((job, i) =>
    scored
      ? {
          ...job,
          fit_score: i === 0 ? first : 0.4,
          ...(behavior.omitRationale ? {} : { fit_rationale: "Matches 1 of 2 skills." }),
        }
      : job,
  );
  return {
    payload: {
      ojcp_version: "0.3",
      query: "engineer",
      total_results: jobs.length,
      returned: jobs.length,
      offset: 0,
      jobs,
      ...(overScope && behavior.warnOnIgnoredField
        ? {
            warnings: [
              { code: "fields_ignored", message: "Field exceeds scope", fields: ["name"] },
            ],
          }
        : {}),
    },
  };
}

let server: Server | undefined;

afterEach(async () => {
  await new Promise((done) => (server ? server.close(done) : done(undefined)));
  server = undefined;
});

/** Starts a stub provider on a local port and runs the suite against it. */
async function runAgainst(behavior: ProviderBehavior): Promise<ConformanceReport> {
  server = createServer((req, res) => {
    const origin = `http://${req.headers.host}`;
    const json = (body: unknown) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(body));
    };
    if (req.method === "GET") {
      json({
        ojcp_version: "0.3",
        provider: { name: "Stub Provider" },
        mcp_endpoint: `${origin}/mcp`,
        tools: ["search_jobs"],
      });
      return;
    }
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => {
      const { id, method, params } = JSON.parse(raw);
      if (method === "initialize") {
        json({ jsonrpc: "2.0", id, result: { serverInfo: { name: "stub" } } });
      } else if (method === "tools/call") {
        const { payload, error } = search(params.arguments, behavior);
        const text = error ?? JSON.stringify(payload);
        json({
          jsonrpc: "2.0",
          id,
          result: { content: [{ type: "text", text }], ...(error ? { isError: true } : {}) },
        });
      } else {
        res.writeHead(202).end();
      }
    });
  });
  await new Promise<void>((done) => server!.listen(0, "127.0.0.1", done));
  const { port } = server.address() as AddressInfo;
  return runConformanceSuite(`http://127.0.0.1:${port}`);
}

function statusOf(report: ConformanceReport, test: string) {
  return report.results.find((r) => r.test === test)?.status;
}

function messageOf(report: ConformanceReport, test: string) {
  return report.results.find((r) => r.test === test)?.message;
}

describe("runConformanceSuite: search_jobs with candidate context", () => {
  it("passes a provider that scores, drops the over-scope field and warns", async () => {
    const report = await runAgainst({ warnOnIgnoredField: true });
    expect(report.failed).toBe(0);
    expect(statusOf(report, "fit-score-absent-without-candidate-context")).toBe("passed");
    expect(statusOf(report, "candidate-context-accepted")).toBe("passed");
    expect(statusOf(report, "fit-score-valid")).toBe("passed");
    expect(statusOf(report, "candidate-context-over-scope-not-rejected")).toBe("passed");
    expect(messageOf(report, "candidate-context-over-scope-not-rejected")).toBe(
      "fields_ignored warning returned",
    );
  });

  it("passes a provider that ignores candidate context, and skips the score check", async () => {
    const report = await runAgainst({ fitScore: null });
    expect(report.failed).toBe(0);
    expect(statusOf(report, "candidate-context-accepted")).toBe("passed");
    expect(statusOf(report, "fit-score-valid")).toBe("skipped");
    expect(messageOf(report, "candidate-context-over-scope-not-rejected")).toMatch(
      /No fields_ignored warning/,
    );
  });

  it("skips, and does not fail, a provider that rejects candidate context", async () => {
    const report = await runAgainst({ rejectCandidateContext: true });
    expect(report.failed).toBe(0);
    expect(statusOf(report, "candidate-context-accepted")).toBe("skipped");
    expect(messageOf(report, "candidate-context-accepted")).toMatch(/disallowed additional/);
    expect(statusOf(report, "candidate-context-over-scope-not-rejected")).toBeUndefined();
  });

  it("fails a provider that rejects a field beyond the declared scope", async () => {
    const report = await runAgainst({ rejectOverScope: true });
    expect(statusOf(report, "candidate-context-accepted")).toBe("passed");
    expect(statusOf(report, "candidate-context-over-scope-not-rejected")).toBe("failed");
  });

  it("fails a fit_score outside 0 to 1", async () => {
    const report = await runAgainst({ fitScore: 80 });
    expect(statusOf(report, "fit-score-valid")).toBe("failed");
  });

  it("reports scores that come without a rationale", async () => {
    const report = await runAgainst({ omitRationale: true });
    expect(statusOf(report, "fit-score-valid")).toBe("passed");
    expect(messageOf(report, "fit-score-valid")).toBe("2 jobs scored, 2 without fit_rationale");
  });

  it("fails a provider that scores a search sent without candidate context", async () => {
    const report = await runAgainst({ scoreAnonymousSearch: true });
    expect(statusOf(report, "fit-score-absent-without-candidate-context")).toBe("failed");
  });
});
