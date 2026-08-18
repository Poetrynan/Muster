#!/usr/bin/env node
/**
 * One-command version bump for Muster.
 *
 * Usage:
 *   node scripts/bump-version.mjs 0.1.8          # bump everything
 *   node scripts/bump-version.mjs 0.1.8 --dry    # preview only, no writes
 *
 * Single source of truth: src-tauri/tauri.conf.json (current version is read
 * from it, so you can never pass a wrong "old" version).
 *
 * Updates: tauri.conf.json, package.json, package-lock.json, Cargo.toml,
 * release.yml (default tag + description), and the four READMEs
 * (badge + installer file names). Cargo.lock is refreshed by `cargo check`
 * during the release flow. RELEASE_NOTES.md is left alone (the new-version
 * section is written by the release author).
 */
import { readFileSync, writeFileSync } from "node:fs";

const newVersion = process.argv[2];
const dry = process.argv.includes("--dry");

if (!/^\d+\.\d+\.\d+$/.test(newVersion || "")) {
  console.error('Usage: node scripts/bump-version.mjs <x.y.z> [--dry]');
  process.exit(1);
}

const write = (path, content) => {
  if (dry) {
    console.log(`  [dry] would write ${path}`);
  } else {
    writeFileSync(path, content, "utf8");
    console.log(`  ok ${path}`);
  }
};

// 1. current version from tauri.conf.json (single source of truth)
const tauriPath = "src-tauri/tauri.conf.json";
const tauri = JSON.parse(readFileSync(tauriPath, "utf8"));
const oldVersion = tauri.version;
if (oldVersion === newVersion) {
  console.log(`Already at ${newVersion} — nothing to do.`);
  process.exit(0);
}
console.log(`Bumping ${oldVersion} -> ${newVersion}${dry ? " (dry run)" : ""}`);

// 2. tauri.conf.json
tauri.version = newVersion;
write(tauriPath, JSON.stringify(tauri, null, 2) + "\n");

// 3. package.json + package-lock.json
for (const f of ["package.json", "package-lock.json"]) {
  const j = JSON.parse(readFileSync(f, "utf8"));
  j.version = newVersion;
  write(f, JSON.stringify(j, null, 2) + "\n");
}

// 4. Cargo.toml
let cargo = readFileSync("src-tauri/Cargo.toml", "utf8");
cargo = cargo.replace(/^version = ".*"$/m, `version = "${newVersion}"`);
write("src-tauri/Cargo.toml", cargo);

// 5. release.yml
let yml = readFileSync(".github/workflows/release.yml", "utf8");
yml = yml.replace(/default: "v[^"]+"/, `default: "v${newVersion}"`);
yml = yml.replace(
  /description: "Release tag \(e\.g\., v[^"]+\)"/,
  `description: "Release tag (e.g., v${newVersion})"`
);
write(".github/workflows/release.yml", yml);

// 6. READMEs: version badge + installer file names
for (const f of ["README.md", "README.zh-CN.md", "README.ja.md", "README.ko.md"]) {
  let s = readFileSync(f, "utf8");
  const before = s;
  s = s.replace(new RegExp(`version-${oldVersion.replace(/\./g, "\\.")}`, "g"), `version-${newVersion}`);
  s = s.replace(new RegExp(`Muster_${oldVersion.replace(/\./g, "\\.")}`, "g"), `Muster_${newVersion}`);
  if (s !== before) write(f, s);
  else console.log(`  (no change) ${f}`);
}

console.log(`\nDone. Next: cargo check (refreshes Cargo.lock), then commit + tag v${newVersion}.`);
