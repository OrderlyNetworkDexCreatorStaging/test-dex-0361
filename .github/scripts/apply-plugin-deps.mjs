#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * Re-applies Orderly One plugin dependency pins after the template upstream
 * merge. The merge rewrites package.json (and a `-X theirs` resolution always
 * takes the upstream side), which drops the pins that
 * `app/plugins/generated.ts` needs. This script restores exactly the entries
 * recorded in .orderly-plugin-deps.json.
 *
 * Deliberately dumb: offline, no resolution logic, no network. The API
 * validated and pinned every version before committing the manifest. Only
 * exact versions are accepted (no ranges, protocols, git/file/workspace
 * specifiers) and the count is capped, so a tampered manifest cannot inject
 * arbitrary install targets. A missing manifest is a no-op.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const MANIFEST = ".orderly-plugin-deps.json";
const PACKAGE_JSON = "package.json";
const MAX_PINS = 20;
const EXACT_VERSION_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const PACKAGE_NAME_RE = /^(?:@[a-z0-9-*~][a-z0-9-*._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/;

const root = process.cwd();
const manifestPath = join(root, MANIFEST);

if (!existsSync(manifestPath)) {
  console.log("No Orderly One plugin manifest — nothing to re-apply.");
  process.exit(0);
}

let manifest;
try {
  manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
} catch (error) {
  console.error(`[plugins] ${MANIFEST} is not valid JSON:`, error.message);
  process.exit(1);
}

const pins = manifest?.dependencies;
if (!pins || typeof pins !== "object" || Array.isArray(pins)) {
  console.log(`${MANIFEST} has no dependency pins — nothing to re-apply.`);
  process.exit(0);
}

const entries = Object.entries(pins);
if (entries.length > MAX_PINS) {
  console.error(
    `[plugins] ${MANIFEST} lists ${entries.length} pins (max ${MAX_PINS}).`
  );
  process.exit(1);
}
for (const [name, version] of entries) {
  if (!PACKAGE_NAME_RE.test(name) || typeof version !== "string") {
    console.error(`[plugins] refusing malformed pin: ${name}=${version}`);
    process.exit(1);
  }
  if (!EXACT_VERSION_RE.test(version)) {
    console.error(
      `[plugins] refusing non-exact version for ${name}: ${version}`
    );
    process.exit(1);
  }
}

const packagePath = join(root, PACKAGE_JSON);
let pkg;
try {
  pkg = JSON.parse(readFileSync(packagePath, "utf-8"));
} catch (error) {
  console.error(`[plugins] ${PACKAGE_JSON} could not be read:`, error.message);
  process.exit(1);
}
if (!pkg.dependencies || typeof pkg.dependencies !== "object") {
  pkg.dependencies = {};
}

let changed = 0;
for (const [name, version] of entries) {
  if (pkg.dependencies[name] === version) continue;
  const previous = pkg.dependencies[name];
  console.log(
    `[plugins] re-applying ${name}@${version}` +
      (previous ? ` (was ${previous})` : "")
  );
  pkg.dependencies[name] = version;
  changed += 1;
}

if (changed === 0) {
  console.log("[plugins] all plugin dependency pins already present.");
  process.exit(0);
}

writeFileSync(packagePath, `${JSON.stringify(pkg, null, 2)}\n`, "utf-8");
console.log(`[plugins] re-applied ${changed} plugin dependency pin(s).`);
