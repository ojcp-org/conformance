#!/usr/bin/env node

import { Command } from "commander";
import chalk from "chalk";
import { readFileSync } from "node:fs";
import {
  runConformanceSuite,
  validateManifest,
  validateJobPosting,
  type TestResult,
} from "./index.js";

const VERSION = "0.1.0";

const icons = {
  passed: chalk.green("\u2713"),
  failed: chalk.red("\u2717"),
  skipped: chalk.yellow("\u25CB"),
} as const;

function formatResult(r: TestResult): string {
  const icon = icons[r.status];
  let line = `  ${icon} ${r.test}`;
  if (r.message) line += chalk.dim(` \u2014 ${r.message}`);
  if (r.errors) {
    const summary = r.errors.map((e) => `${e.instancePath || "/"}: ${e.message}`).join("; ");
    line += `\n    ${chalk.red(summary)}`;
  }
  return line;
}

function printReport(passed: number, failed: number, skipped: number): void {
  console.log();
  console.log(
    `  ${chalk.green(`${passed} passed`)}  ${chalk.red(`${failed} failed`)}  ${chalk.yellow(`${skipped} skipped`)}`,
  );
  console.log();
}

const program = new Command()
  .name("ojcp-conformance")
  .description("OJCP conformance test suite — validate provider implementations against the spec")
  .version(VERSION);

program
  .command("test")
  .description("Run full conformance suite against a live OJCP endpoint")
  .argument("<url>", "Provider base URL (e.g., https://ojcp.dev)")
  .option("--json", "Output results as JSON (for CI)")
  .action(async (url: string, opts: { json?: boolean }) => {
    console.log();
    console.log(`  ${chalk.bold("OJCP Conformance Suite")} ${chalk.dim(`v${VERSION}`)}`);
    console.log(`  ${chalk.dim("Target:")} ${url}`);
    console.log();

    const report = await runConformanceSuite(url);

    if (opts.json) {
      console.log(JSON.stringify(report, null, 2));
    } else {
      for (const r of report.results) {
        console.log(formatResult(r));
      }
      printReport(report.passed, report.failed, report.skipped);
    }
    process.exit(report.failed > 0 ? 1 : 0);
  });

program
  .command("validate")
  .description("Validate a local JSON file against OJCP schemas")
  .argument("<file>", "Path to JSON file")
  .option("-t, --type <type>", "Schema type: manifest, job-posting", "auto")
  .action((file: string, opts: { type: string }) => {
    const data = JSON.parse(readFileSync(file, "utf8"));

    let schemaType = opts.type;
    if (schemaType === "auto") {
      if (data.ojcp_version && data.tools) schemaType = "manifest";
      else if (data.ojcp_id && data.title) schemaType = "job-posting";
      else schemaType = "manifest";
    }

    console.log();
    console.log(`  Validating ${chalk.bold(schemaType)}: ${file}`);
    console.log();

    const result = schemaType === "job-posting" ? validateJobPosting(data) : validateManifest(data);

    if (result.valid) {
      console.log(`  ${chalk.green("\u2713 Valid")}`);
      console.log();
      process.exit(0);
    } else {
      console.log(`  ${chalk.red("\u2717 Invalid")}`);
      console.log();
      for (const err of result.errors ?? []) {
        console.log(`    ${chalk.dim(err.instancePath || "/")} ${err.message}`);
      }
      console.log();
      process.exit(1);
    }
  });

// Shortcut: if first arg is a valid URL, treat as `test <url>`
const args = process.argv.slice(2);
if (args.length > 0 && URL.canParse(args[0])) {
  process.argv = [...process.argv.slice(0, 2), "test", ...args];
}

program.parse();
