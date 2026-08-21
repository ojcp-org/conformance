/**
 * Experimental authorization fixtures for the user-mandate profile proposed
 * in https://github.com/ojcp-org/ojcp/pull/9.
 *
 * The inputs are verified facts. Credential and HTTP-signature verification
 * deliberately remain the responsibility of each integration.
 */

export const USER_MANDATE_FIXTURE_VERSION = "0.1-draft";

export type UserMandateFailure =
  | "agent_signature_invalid"
  | "user_mandate_required"
  | "candidate_proof_not_authorization"
  | "platform_identity_not_user_authority"
  | "mandate_issuer_not_admitted"
  | "mandate_agent_key_mismatch"
  | "mandate_audience_mismatch"
  | "mandate_action_mismatch"
  | "mandate_expired"
  | "mandate_revoked"
  | "mandate_replayed";

export interface MandatedAction {
  resourceServer: string;
  employerId?: string;
  jobId: string;
  applicationId: string;
  candidateDataDigest: string;
  mandateNonce: string;
}

export interface UserMandate {
  issuerKind: "user" | "platform";
  issuerKey: string;
  agentKey: string;
  audience: string;
  jti: string;
  notBefore: string;
  expiresAt: string;
  status: "active" | "revoked";
  consumed?: boolean;
  action: MandatedAction;
}

export interface UserMandateFixture {
  id: string;
  description: string;
  now: string;
  admittedUserIssuerKeys: string[];
  request: {
    agentSignatureValid: boolean;
    agentKey: string;
    candidateIdentityProofValid?: boolean;
    action: MandatedAction;
  };
  mandate?: UserMandate;
  expected: { accepted: boolean; failure?: UserMandateFailure };
}

export function evaluateUserMandateFixture(fixture: UserMandateFixture): {
  accepted: boolean;
  failure?: UserMandateFailure;
} {
  const { request, mandate } = fixture;
  if (!request.agentSignatureValid) return { accepted: false, failure: "agent_signature_invalid" };
  if (!mandate) {
    return {
      accepted: false,
      failure: request.candidateIdentityProofValid
        ? "candidate_proof_not_authorization"
        : "user_mandate_required",
    };
  }
  if (mandate.issuerKind !== "user") {
    return { accepted: false, failure: "platform_identity_not_user_authority" };
  }
  if (!fixture.admittedUserIssuerKeys.includes(mandate.issuerKey)) {
    return { accepted: false, failure: "mandate_issuer_not_admitted" };
  }
  if (mandate.agentKey !== request.agentKey) {
    return { accepted: false, failure: "mandate_agent_key_mismatch" };
  }
  if (mandate.audience !== request.action.resourceServer) {
    return { accepted: false, failure: "mandate_audience_mismatch" };
  }
  const now = Date.parse(fixture.now);
  if (Date.parse(mandate.notBefore) > now || Date.parse(mandate.expiresAt) < now) {
    return { accepted: false, failure: "mandate_expired" };
  }
  if (mandate.status === "revoked") return { accepted: false, failure: "mandate_revoked" };
  if (mandate.consumed) return { accepted: false, failure: "mandate_replayed" };
  if (
    mandate.action.resourceServer !== request.action.resourceServer ||
    mandate.action.employerId !== request.action.employerId ||
    mandate.action.jobId !== request.action.jobId ||
    mandate.action.applicationId !== request.action.applicationId ||
    mandate.action.candidateDataDigest !== request.action.candidateDataDigest ||
    mandate.action.mandateNonce !== request.action.mandateNonce
  ) {
    return { accepted: false, failure: "mandate_action_mismatch" };
  }
  return { accepted: true };
}

const NOW = "2026-08-21T12:00:00Z";
const ACTION: MandatedAction = {
  resourceServer: "https://apply.example-ats.com",
  employerId: "acme",
  jobId: "apply.example-ats.com:1234",
  applicationId: "app_7f3a",
  candidateDataDigest: "sha256:applicant-data-a",
  mandateNonce: "nonce_7f3a",
};

function mandate(overrides: Partial<UserMandate> = {}): UserMandate {
  return {
    issuerKind: "user",
    issuerKey: "user-key-a",
    agentKey: "agent-key-a",
    audience: ACTION.resourceServer,
    jti: "mandate-a",
    notBefore: "2026-08-21T11:55:00Z",
    expiresAt: "2026-08-21T12:05:00Z",
    status: "active",
    action: ACTION,
    ...overrides,
  };
}

function vector(
  id: string,
  description: string,
  expected: UserMandateFixture["expected"],
  overrides: Partial<UserMandateFixture> = {},
): UserMandateFixture {
  return {
    id,
    description,
    now: NOW,
    admittedUserIssuerKeys: ["user-key-a"],
    request: { agentSignatureValid: true, agentKey: "agent-key-a", action: ACTION },
    mandate: mandate(),
    expected,
    ...overrides,
  };
}

export const USER_MANDATE_FIXTURES: UserMandateFixture[] = [
  vector("valid-single-use-mandate", "Accept the exact user-authorized action.", {
    accepted: true,
  }),
  vector(
    "invalid-agent-signature",
    "Reject an unauthenticated agent before evaluating a mandate.",
    { accepted: false, failure: "agent_signature_invalid" },
    { request: { agentSignatureValid: false, agentKey: "agent-key-a", action: ACTION } },
  ),
  vector(
    "missing-mandate",
    "Reject a signed agent request without user authority.",
    { accepted: false, failure: "user_mandate_required" },
    { mandate: undefined },
  ),
  vector(
    "candidate-proof-is-not-mandate",
    "Do not treat candidate verification as authorization.",
    { accepted: false, failure: "candidate_proof_not_authorization" },
    {
      mandate: undefined,
      request: {
        agentSignatureValid: true,
        agentKey: "agent-key-a",
        candidateIdentityProofValid: true,
        action: ACTION,
      },
    },
  ),
  vector(
    "platform-credential-is-not-user-authority",
    "Reject platform identity as user authority.",
    { accepted: false, failure: "platform_identity_not_user_authority" },
    { mandate: mandate({ issuerKind: "platform" }) },
  ),
  vector(
    "unadmitted-issuer",
    "Reject an issuer not admitted by policy.",
    { accepted: false, failure: "mandate_issuer_not_admitted" },
    { mandate: mandate({ issuerKey: "user-key-b" }) },
  ),
  vector(
    "wrong-agent-key",
    "Reject a mandate exercised by another agent key.",
    { accepted: false, failure: "mandate_agent_key_mismatch" },
    { request: { agentSignatureValid: true, agentKey: "agent-key-b", action: ACTION } },
  ),
  vector(
    "wrong-ats-audience",
    "Reject a mandate presented to another ATS.",
    { accepted: false, failure: "mandate_audience_mismatch" },
    {
      request: {
        agentSignatureValid: true,
        agentKey: "agent-key-a",
        action: { ...ACTION, resourceServer: "https://other.example-ats.com" },
      },
    },
  ),
  vector(
    "wrong-employer-on-shared-ats",
    "Reject Acme's mandate for another ATS tenant.",
    { accepted: false, failure: "mandate_action_mismatch" },
    {
      request: {
        agentSignatureValid: true,
        agentKey: "agent-key-a",
        action: { ...ACTION, employerId: "other-employer" },
      },
    },
  ),
  vector(
    "wrong-job",
    "Reject a mandate reused for another job at the same employer.",
    { accepted: false, failure: "mandate_action_mismatch" },
    {
      request: {
        agentSignatureValid: true,
        agentKey: "agent-key-a",
        action: { ...ACTION, jobId: "apply.example-ats.com:5678" },
      },
    },
  ),
  vector(
    "changed-candidate-data",
    "Reject data changed after consent.",
    { accepted: false, failure: "mandate_action_mismatch" },
    {
      request: {
        agentSignatureValid: true,
        agentKey: "agent-key-a",
        action: { ...ACTION, candidateDataDigest: "sha256:applicant-data-b" },
      },
    },
  ),
  vector(
    "expired-mandate",
    "Reject an expired mandate.",
    { accepted: false, failure: "mandate_expired" },
    { mandate: mandate({ expiresAt: "2026-08-21T11:59:59Z" }) },
  ),
  vector(
    "revoked-mandate",
    "Reject a revoked mandate.",
    { accepted: false, failure: "mandate_revoked" },
    { mandate: mandate({ status: "revoked" }) },
  ),
  vector(
    "replayed-mandate",
    "Reject a consumed single-use mandate.",
    { accepted: false, failure: "mandate_replayed" },
    { mandate: mandate({ consumed: true }) },
  ),
];
