import { describe, it, expect } from "vitest";
import {
  validateManifest,
  validateJobPosting,
  validateCandidateContext,
  validateAgentDeclaration,
  validateVerificationProof,
  validateVerifierManifest,
  validateToolResponse,
} from "./index.js";

describe("validateManifest", () => {
  it("accepts a valid minimal manifest", () => {
    const { valid } = validateManifest({
      ojcp_version: "0.1",
      provider: { name: "Acme Careers" },
      tools: ["search_jobs"],
    });
    expect(valid).toBe(true);
  });

  it("accepts a full manifest", () => {
    const { valid } = validateManifest({
      ojcp_version: "0.1",
      provider: {
        name: "Acme Careers",
        employer_id: "acme",
        description: "Tech company",
        industries: ["technology"],
      },
      mcp_endpoint: "https://careers.acme.com/mcp",
      tools: ["search_jobs", "get_job_detail", "begin_application"],
      apply_paths: ["ats_direct", "adaptive_apply"],
      rate_limits: { anonymous_rps: 10, authenticated_rps: 50 },
    });
    expect(valid).toBe(true);
  });

  it("rejects manifest missing ojcp_version", () => {
    const { valid } = validateManifest({
      provider: { name: "Acme" },
      tools: ["search_jobs"],
    });
    expect(valid).toBe(false);
  });

  it("rejects manifest missing tools", () => {
    const { valid } = validateManifest({
      ojcp_version: "0.1",
      provider: { name: "Acme" },
    });
    expect(valid).toBe(false);
  });

  it("rejects manifest missing provider", () => {
    const { valid } = validateManifest({
      ojcp_version: "0.1",
      tools: ["search_jobs"],
    });
    expect(valid).toBe(false);
  });
});

describe("validateJobPosting", () => {
  it("accepts a valid minimal job posting", () => {
    const { valid } = validateJobPosting({
      ojcp_id: "acme:swe-001",
      title: "Software Engineer",
      employer: { name: "Acme Corp" },
      datePosted: "2026-03-01",
    });
    expect(valid).toBe(true);
  });

  it("accepts a full job posting with ATS fields", () => {
    const { valid } = validateJobPosting({
      ojcp_id: "acme:swe-001",
      title: "Senior Backend Engineer",
      employer: { name: "Acme Corp", ojcp_employer_id: "acme" },
      datePosted: "2026-03-01",
      employmentType: "full_time",
      skills_required: ["Go", "PostgreSQL"],
      skills_preferred: ["Kubernetes"],
      urgency: "high",
      requisition_id: "REQ-001",
      department: "Engineering",
      remote_policy: "remote",
      apply_paths: [
        {
          type: "adaptive_apply",
          supports_agent_submission: true,
          url: "https://careers.acme.com/apply/swe-001",
        },
      ],
    });
    expect(valid).toBe(true);
  });

  it("rejects job posting missing title", () => {
    const { valid } = validateJobPosting({
      ojcp_id: "acme:swe-001",
      employer: { name: "Acme" },
      datePosted: "2026-03-01",
    });
    expect(valid).toBe(false);
  });

  it("rejects invalid urgency value", () => {
    const { valid } = validateJobPosting({
      ojcp_id: "acme:swe-001",
      title: "Engineer",
      employer: { name: "Acme" },
      datePosted: "2026-03-01",
      urgency: "extreme",
    });
    expect(valid).toBe(false);
  });

  it("rejects invalid apply_path type", () => {
    const { valid } = validateJobPosting({
      ojcp_id: "acme:swe-001",
      title: "Engineer",
      employer: { name: "Acme" },
      datePosted: "2026-03-01",
      apply_paths: [{ type: "invalid_path", supports_agent_submission: true }],
    });
    expect(valid).toBe(false);
  });
});

describe("validateCandidateContext", () => {
  it("accepts valid candidate context", () => {
    const { valid } = validateCandidateContext({
      ojcp_candidate_context_version: "0.1",
      consent_scope: "fit_scoring",
      skills: ["Python", "SQL"],
      experience_years: 5,
    });
    expect(valid).toBe(true);
  });

  it("accepts all valid consent scopes", () => {
    for (const scope of [
      "search_personalization",
      "fit_scoring",
      "application_prefill",
      "full_profile",
    ]) {
      const { valid } = validateCandidateContext({
        ojcp_candidate_context_version: "0.1",
        consent_scope: scope,
      });
      expect(valid).toBe(true);
    }
  });

  it("rejects invalid consent_scope", () => {
    const { valid } = validateCandidateContext({
      ojcp_candidate_context_version: "0.1",
      consent_scope: "unlimited",
    });
    expect(valid).toBe(false);
  });
});

describe("validateAgentDeclaration", () => {
  it("accepts valid agent declaration", () => {
    const { valid } = validateAgentDeclaration({
      agent_id: "com.example.jobagent",
      agent_version: "1.0.0",
      acting_on_behalf_of: "human_user",
      interaction_mode: "assisted",
    });
    expect(valid).toBe(true);
  });

  it("accepts all valid acting_on_behalf_of values", () => {
    for (const value of ["human_user", "recruiter", "autonomous_workflow"]) {
      const { valid } = validateAgentDeclaration({
        agent_id: "test",
        acting_on_behalf_of: value,
      });
      expect(valid).toBe(true);
    }
  });

  it("rejects invalid acting_on_behalf_of", () => {
    const { valid } = validateAgentDeclaration({
      agent_id: "test",
      acting_on_behalf_of: "robot",
    });
    expect(valid).toBe(false);
  });
});

describe("validateVerificationProof", () => {
  it("accepts valid proof", () => {
    const { valid } = validateVerificationProof({
      step_id: "vs_1",
      verifier_id: "id.me",
      verification_type: "identity",
      proof_token: "eyJhbGciOiJFUzI1NiJ9.eyJpc3MiOiJpZC5tZSJ9.sig",
      subject_hash: "abc123",
      issued_at: "2026-03-18T14:30:00Z",
      expires_at: "2026-03-19T14:30:00Z",
    });
    expect(valid).toBe(true);
  });

  it("rejects proof missing subject_hash", () => {
    const { valid } = validateVerificationProof({
      step_id: "vs_1",
      verifier_id: "id.me",
      verification_type: "identity",
      proof_token: "token",
      issued_at: "2026-03-18T14:30:00Z",
      expires_at: "2026-03-19T14:30:00Z",
    });
    expect(valid).toBe(false);
  });

  it("accepts all valid verification types", () => {
    for (const type of [
      "identity",
      "government_id",
      "biometric",
      "address",
      "employment",
      "education",
      "background_check",
    ]) {
      const { valid } = validateVerificationProof({
        step_id: "vs_1",
        verifier_id: "id.me",
        verification_type: type,
        proof_token: "token",
        subject_hash: "hash",
        issued_at: "2026-03-18T14:30:00Z",
        expires_at: "2026-03-19T14:30:00Z",
      });
      expect(valid).toBe(true);
    }
  });
});

describe("validateVerifierManifest", () => {
  it("accepts valid verifier manifest", () => {
    const { valid } = validateVerifierManifest({
      ojcp_verifier_version: "0.1",
      verifier_id: "id.me",
      verifier_name: "ID.me",
      verification_types: ["identity"],
      proof_format: "jws",
      public_keys_url: "https://id.me/.well-known/jwks.json",
    });
    expect(valid).toBe(true);
  });

  it("accepts verifier manifest with proof_delivery_methods", () => {
    const { valid } = validateVerifierManifest({
      ojcp_verifier_version: "0.1",
      verifier_id: "id.me",
      verifier_name: "ID.me",
      verification_types: ["identity"],
      proof_format: "jws",
      proof_delivery_methods: ["callback", "redirect", "polling"],
      signing_algorithms: ["ES256"],
      public_keys_url: "https://id.me/.well-known/jwks.json",
    });
    expect(valid).toBe(true);
  });

  it("rejects verifier manifest missing public_keys_url", () => {
    const { valid } = validateVerifierManifest({
      ojcp_verifier_version: "0.1",
      verifier_id: "id.me",
      verifier_name: "ID.me",
      verification_types: ["identity"],
      proof_format: "jws",
    });
    expect(valid).toBe(false);
  });
});

describe("validateToolResponse", () => {
  it("validates a search-jobs response", () => {
    const { valid } = validateToolResponse("search-jobs", {
      ojcp_version: "0.1",
      query: "engineer",
      total_results: 1,
      returned: 1,
      offset: 0,
      jobs: [
        {
          ojcp_id: "acme:swe-001",
          title: "Engineer",
          employer: { name: "Acme" },
          datePosted: "2026-03-01",
        },
      ],
    });
    expect(valid).toBe(true);
  });

  it("validates an error response", () => {
    const { valid } = validateToolResponse("error", {
      ojcp_version: "0.1",
      error_code: "job_not_found",
      message: "No job found",
    });
    expect(valid).toBe(true);
  });

  it("throws on invalid tool type", () => {
    expect(() => validateToolResponse("bogus" as any, {})).toThrow("Invalid tool response type");
  });
});
