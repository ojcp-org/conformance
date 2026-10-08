/**
 * Reference evaluator and fixtures for OJCP attribution — spec § Attribution.
 *
 * The evaluator decides which evidence credits an application at `begin_application`. Decoding
 * and integrity-checking an `attribution_ref` is the provider's own business, since the reference
 * is opaque; the integration passes the decoded claims in, with `intact: false` for one that failed
 * its integrity check.
 */

export const ATTRIBUTION_FIXTURE_VERSION = "0.3";

const DAY_MS = 86_400_000;

/** Spec § Definitions, Attributable identity: a verified agent_id, else a provider-issued credential. */
export interface AttributableIdentity {
  kind: "verified_agent" | "credential";
  id: string;
}

/** What the provider knows about a caller. A self-asserted agent_id is deliberately absent. */
export interface Caller {
  /** An agent_id verified under spec § Agent Identity. */
  verifiedAgentId?: string;
  /** A credential the provider issued (API key, OAuth client). */
  credential?: string;
}

export interface Impression {
  id: string;
  identity: AttributableIdentity;
  ojcpId: string;
  /** ISO 8601. */
  servedAt: string;
}

/** The claims of an `attribution_ref`, as decoded by the provider that issued it. */
export interface AttributionReference {
  /** False when the reference failed its integrity check (forged or altered). */
  intact: boolean;
  impressionId: string;
  ojcpId: string;
  /** The identity the reference was issued to; null when it was issued to an anonymous caller. */
  issuedTo: AttributableIdentity | null;
  /** ISO 8601. */
  expiresAt: string;
}

export type AttributionResult =
  | {
      method: "reference";
      impressionId: string;
      /** Spec § Establishing Attribution rule 1: the other identity the reference was issued to. */
      referredBy?: string;
      /**
       * The caller's own matching impression when a foreign reference is credited. Kept, never
       * erased (spec § Security Considerations, Reference stuffing).
       */
      applyingImpressionId?: string;
    }
  | { method: "impression_match"; impressionId: string }
  | { method: "none" };

export interface AttributionInput {
  jobId: string;
  /** ISO 8601. */
  now: string;
  windowDays: number;
  caller: Caller;
  /** `source_attribution.attribution_ref` decoded, or null when absent. */
  reference: AttributionReference | null;
  /** The provider's impression records. */
  impressions: Impression[];
}

/** Spec § Definitions: the caller's attributable identity, strongest first; null when anonymous. */
export function attributableIdentity(caller: Caller): AttributableIdentity | null {
  if (caller.verifiedAgentId) return { kind: "verified_agent", id: caller.verifiedAgentId };
  if (caller.credential) return { kind: "credential", id: caller.credential };
  return null;
}

function sameIdentity(a: AttributableIdentity, b: AttributableIdentity): boolean {
  return a.kind === b.kind && a.id === b.id;
}

/** Spec § Attribution References: a reference that is not usable counts as absent. */
function usableReference(input: AttributionInput): AttributionReference | null {
  const { reference } = input;
  if (reference === null || !reference.intact) return null;
  if (reference.ojcpId !== input.jobId) return null;
  if (Date.parse(input.now) >= Date.parse(reference.expiresAt)) return null;
  return reference;
}

/** Rule 2: the caller's most recent impression of the job inside the window (last touch). */
function latestOwnImpression(
  input: AttributionInput,
  identity: AttributableIdentity | null,
): Impression | null {
  if (identity === null) return null;
  const now = Date.parse(input.now);
  const earliest = now - input.windowDays * DAY_MS;
  let latest: Impression | null = null;
  for (const impression of input.impressions) {
    const servedAt = Date.parse(impression.servedAt);
    if (
      impression.ojcpId === input.jobId &&
      sameIdentity(impression.identity, identity) &&
      servedAt >= earliest &&
      servedAt <= now &&
      (latest === null || servedAt > Date.parse(latest.servedAt))
    ) {
      latest = impression;
    }
  }
  return latest;
}

/** Spec § Establishing Attribution: rules 1–3, applied at `begin_application`. */
export function evaluateAttribution(input: AttributionInput): AttributionResult {
  const identity = attributableIdentity(input.caller);
  const own = latestOwnImpression(input, identity);
  const reference = usableReference(input);

  if (reference !== null) {
    const issuer = reference.issuedTo;
    if (issuer === null || (identity !== null && sameIdentity(issuer, identity))) {
      return { method: "reference", impressionId: reference.impressionId };
    }
    return {
      method: "reference",
      impressionId: reference.impressionId,
      referredBy: issuer.id,
      ...(own !== null && { applyingImpressionId: own.id }),
    };
  }
  if (own !== null) return { method: "impression_match", impressionId: own.id };
  return { method: "none" };
}

/**
 * Spec § Establishing Attribution: attribution is fixed at `begin_application`. A reference on
 * `submit_application` is considered only when the application was unattributed at begin.
 */
export function evaluateSubmitAttribution(
  atBegin: AttributionResult,
  atSubmit: AttributionInput,
): AttributionResult {
  if (atBegin.method !== "none") return atBegin;
  // Rule 2 already found nothing at begin, so only a reference can change the outcome.
  return evaluateAttribution({ ...atSubmit, impressions: [] });
}

export interface AttributionFixture {
  id: string;
  description: string;
  input: AttributionInput;
  /** When present, the application was begun with this outcome and `input` is the submit call. */
  atBegin?: AttributionResult;
  expected: AttributionResult;
}

/** Runs a fixture at begin, or at submit when it states the begin outcome. */
export function evaluateAttributionFixture(fixture: AttributionFixture): AttributionResult {
  return fixture.atBegin === undefined
    ? evaluateAttribution(fixture.input)
    : evaluateSubmitAttribution(fixture.atBegin, fixture.input);
}

const JOB = "careers.acme.com:swe-42091";
const OTHER_JOB = "jobs.globex.com:be-10455";
const NOW = "2026-10-08T12:00:00Z";
const WINDOW_DAYS = 30;

const AGENT: AttributableIdentity = { kind: "verified_agent", id: "ai.wayfarer.agent" };
const BOARD: AttributableIdentity = { kind: "verified_agent", id: "com.example.jobboard" };
const PARTNER: AttributableIdentity = { kind: "credential", id: "partner_key_acme" };

function daysBefore(days: number, extraMs = 0): string {
  return new Date(Date.parse(NOW) - days * DAY_MS - extraMs).toISOString();
}

function impression(
  id: string,
  identity: AttributableIdentity,
  servedAt: string,
  ojcpId = JOB,
): Impression {
  return { id, identity, ojcpId, servedAt };
}

function reference(
  impressionId: string,
  issuedTo: AttributableIdentity | null,
  overrides: Partial<AttributionReference> = {},
): AttributionReference {
  return {
    intact: true,
    impressionId,
    ojcpId: JOB,
    issuedTo,
    expiresAt: "2026-11-01T00:00:00Z",
    ...overrides,
  };
}

function vector(
  id: string,
  description: string,
  input: Partial<AttributionInput>,
  expected: AttributionResult,
  atBegin?: AttributionResult,
): AttributionFixture {
  return {
    id,
    description,
    input: {
      jobId: JOB,
      now: NOW,
      windowDays: WINDOW_DAYS,
      caller: {},
      reference: null,
      impressions: [],
      ...input,
    },
    expected,
    ...(atBegin !== undefined && { atBegin }),
  };
}

const AS_AGENT: Caller = { verifiedAgentId: AGENT.id };

export const ATTRIBUTION_FIXTURES: AttributionFixture[] = [
  vector(
    "impression-match-without-reference",
    "An agent that searched and applies under the same identity is credited without relaying anything.",
    { caller: AS_AGENT, impressions: [impression("imp-1", AGENT, daysBefore(1))] },
    { method: "impression_match", impressionId: "imp-1" },
  ),
  vector(
    "impression-match-by-credential",
    "A provider-issued credential is an attributable identity.",
    {
      caller: { credential: PARTNER.id },
      impressions: [impression("imp-1", PARTNER, daysBefore(1))],
    },
    { method: "impression_match", impressionId: "imp-1" },
  ),
  vector(
    "no-evidence",
    "No reference and no impression: unattributed.",
    { caller: AS_AGENT },
    { method: "none" },
  ),
  vector(
    "other-identity-impression-not-credited",
    "An impression served to a different identity does not credit the caller.",
    { caller: AS_AGENT, impressions: [impression("imp-board", BOARD, daysBefore(1))] },
    { method: "none" },
  ),
  vector(
    "other-job-impression-not-credited",
    "An impression of a different job does not credit this application.",
    {
      caller: AS_AGENT,
      impressions: [impression("imp-1", AGENT, daysBefore(1), OTHER_JOB)],
    },
    { method: "none" },
  ),
  vector(
    "last-touch",
    "Of the caller's impressions of the job, the most recent is credited.",
    {
      caller: AS_AGENT,
      impressions: [
        impression("imp-old", AGENT, daysBefore(10)),
        impression("imp-new", AGENT, daysBefore(2)),
        impression("imp-mid", AGENT, daysBefore(5)),
      ],
    },
    { method: "impression_match", impressionId: "imp-new" },
  ),
  vector(
    "window-boundary-inclusive",
    "An impression exactly window_days old is still inside the window.",
    { caller: AS_AGENT, impressions: [impression("imp-1", AGENT, daysBefore(WINDOW_DAYS))] },
    { method: "impression_match", impressionId: "imp-1" },
  ),
  vector(
    "window-boundary-expired",
    "An impression one millisecond older than the window is not credited.",
    {
      caller: AS_AGENT,
      impressions: [impression("imp-1", AGENT, daysBefore(WINDOW_DAYS, 1))],
    },
    { method: "none" },
  ),
  vector(
    "anonymous-no-impression-match",
    "An anonymous caller has no attributable identity, so rule 2 never applies to it.",
    { caller: {}, impressions: [impression("imp-1", AGENT, daysBefore(1))] },
    { method: "none" },
  ),
  vector(
    "anonymous-credited-by-reference",
    "An anonymous caller can be credited through a reference.",
    { caller: {}, reference: reference("imp-anon", null) },
    { method: "reference", impressionId: "imp-anon" },
  ),
  vector(
    "own-reference",
    "A reference issued to the caller credits the impression it names, with no referred_by.",
    { caller: AS_AGENT, reference: reference("imp-1", AGENT) },
    { method: "reference", impressionId: "imp-1" },
  ),
  vector(
    "reference-before-impression",
    "Rule 1 precedes rule 2: a valid reference wins over a more recent impression.",
    {
      caller: AS_AGENT,
      reference: reference("imp-ref", AGENT),
      impressions: [impression("imp-later", AGENT, daysBefore(0, 60_000))],
    },
    { method: "reference", impressionId: "imp-ref" },
  ),
  vector(
    "foreign-reference",
    "A reference issued to another identity credits it as referred_by.",
    { caller: AS_AGENT, reference: reference("imp-board", BOARD) },
    { method: "reference", impressionId: "imp-board", referredBy: BOARD.id },
  ),
  vector(
    "foreign-reference-keeps-own-evidence",
    "A foreign reference never erases the applying identity's own impression.",
    {
      caller: AS_AGENT,
      reference: reference("imp-board", BOARD),
      impressions: [impression("imp-own", AGENT, daysBefore(1))],
    },
    {
      method: "reference",
      impressionId: "imp-board",
      referredBy: BOARD.id,
      applyingImpressionId: "imp-own",
    },
  ),
  vector(
    "reference-for-other-job-ignored",
    "A reference bound to a different job is ignored, falling through to rule 2.",
    {
      caller: AS_AGENT,
      reference: reference("imp-board", BOARD, { ojcpId: OTHER_JOB }),
      impressions: [impression("imp-own", AGENT, daysBefore(1))],
    },
    { method: "impression_match", impressionId: "imp-own" },
  ),
  vector(
    "expired-reference-ignored",
    "An expired reference counts as absent.",
    {
      caller: AS_AGENT,
      reference: reference("imp-board", BOARD, { expiresAt: daysBefore(1) }),
    },
    { method: "none" },
  ),
  vector(
    "reference-expiring-now-ignored",
    "A reference whose expiry is the current instant has expired.",
    { caller: AS_AGENT, reference: reference("imp-board", BOARD, { expiresAt: NOW }) },
    { method: "none" },
  ),
  vector(
    "forged-reference-ignored",
    "A reference that fails its integrity check counts as absent; the application is not rejected.",
    {
      caller: AS_AGENT,
      reference: reference("imp-board", BOARD, { intact: false }),
      impressions: [impression("imp-own", AGENT, daysBefore(1))],
    },
    { method: "impression_match", impressionId: "imp-own" },
  ),
  vector(
    "submit-keeps-begin-attribution",
    "Attribution is fixed at begin_application; a reference on submit cannot replace it.",
    { caller: AS_AGENT, reference: reference("imp-board", BOARD) },
    { method: "impression_match", impressionId: "imp-own" },
    { method: "impression_match", impressionId: "imp-own" },
  ),
  vector(
    "submit-reference-when-unattributed",
    "A reference on submit_application is applied when begin found nothing.",
    { caller: AS_AGENT, reference: reference("imp-board", BOARD) },
    { method: "reference", impressionId: "imp-board", referredBy: BOARD.id },
    { method: "none" },
  ),
];
