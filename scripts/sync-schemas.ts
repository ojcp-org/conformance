#!/usr/bin/env tsx

import { writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCHEMAS_DIR = resolve(__dirname, "../schemas");
const BASE_URL = "https://raw.githubusercontent.com/ojcp-org/ojcp/main/schemas";

const SCHEMA_FILES = [
  "manifest.json",
  "job-posting.json",
  "candidate-context.json",
  "agent-declaration.json",
  "verification-step.json",
  "verification-proof.json",
  "verifier-manifest.json",
  "responses/search-jobs.json",
  "responses/job-detail.json",
  "responses/employer-context.json",
  "responses/begin-application.json",
  "responses/submit-application.json",
  "responses/application-status.json",
  "responses/error.json",
] as const;

async function syncSchemas(): Promise<void> {
  console.log("Syncing schemas from ojcp-org/ojcp...\n");

  const results = await Promise.allSettled(
    SCHEMA_FILES.map(async (file) => {
      const url = `${BASE_URL}/${file}`;
      const dest = resolve(SCHEMAS_DIR, file);
      mkdirSync(dirname(dest), { recursive: true });

      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      writeFileSync(dest, await res.text());
      return file;
    }),
  );

  for (const [i, result] of results.entries()) {
    const file = SCHEMA_FILES[i];
    if (result.status === "fulfilled") {
      console.log(`  \x1b[32m\u2713\x1b[0m ${file}`);
    } else {
      console.error(`  \x1b[31m\u2717\x1b[0m ${file} — ${result.reason}`);
    }
  }

  const failed = results.filter((r) => r.status === "rejected").length;
  console.log(`\n${failed === 0 ? "Done." : `${failed} failed.`}`);
  if (failed > 0) process.exit(1);
}

syncSchemas();
