// ── Validate and promote pending SIGNUPS ───────────────────────────────────
//
// Runs from .github/workflows/validate-and-promote.yml on every push that
// touches pending/. Each file under pending/signups/ is one signup request
// written by the btsbootcamp-fanmail Lambda, whose GitHub App installation
// is scoped ONLY to this repo (burnthestage) — it cannot touch
// bestofbootcamp or the site code. That is the entire reason this promotion
// step exists as a separate job with its OWN credential (BOB_TOKEN, scoped
// only to bestofbootcamp).
//
//   1. Read every pending/signups/*.json from the checked-out working copy
//   2. Validate each (well-formed JSON, expected shape, username not taken)
//   3. Batch all valid entries into ONE commit to bestofbootcamp/data/users.json
//   4. Delete every processed file locally — valid or not — so the workflow's
//      "clean up" step commits their removal from burnthestage
//
// Full rationale: btsbootcamp/ARCHITECTURE_DECISIONS.md, "Write pipeline v3".

const fs = require("fs");
const path = require("path");
const { readJsonFile, writeJsonFile } = require("./lib/github");

const MEMBERS = ["RM", "Jin", "Suga", "J-Hope", "Jimin", "V", "Jungkook"];
const PENDING_DIR = path.join(process.cwd(), "pending", "signups");

// Structural validation only — checks shape, not whether the content is
// "good" (a well-formed but spammy username still passes; that needs a
// spam gate, tracked separately). Must stay in sync with the validators in
// btsbootcamp's lambda/fanmail/index.mjs and hooks/useAuth.tsx.
function validate(entry) {
  if (!entry || typeof entry !== "object") return "not an object";
  if (typeof entry.username !== "string" || !entry.username.trim()) return "missing username";
  if (!/^[a-zA-Z0-9_]{3,20}$/.test(entry.username.trim())) return "invalid username format";
  if (entry.pin != null && typeof entry.pin !== "string") return "invalid pin";
  if (entry.pin && !/^[0-9]{4,8}$/.test(entry.pin.trim())) return "invalid pin format";
  if (entry.favoriteMember && !MEMBERS.includes(entry.favoriteMember)) return "invalid favoriteMember";
  if (entry.armyType && !["new", "veteran"].includes(entry.armyType)) return "invalid armyType";
  return null;
}

async function main() {
  const bobToken = process.env.BOB_TOKEN;
  if (!bobToken) throw new Error("BOB_TOKEN not set");

  if (!fs.existsSync(PENDING_DIR)) {
    console.log("No pending/signups directory, nothing to do.");
    return;
  }
  const files = fs.readdirSync(PENDING_DIR).filter((f) => f.endsWith(".json"));
  if (files.length === 0) {
    console.log("No pending signups.");
    return;
  }

  const { content: users, sha } = await readJsonFile("data/users.json", bobToken);
  // Tracks usernames across the live list AND anything accepted earlier in
  // this same run, so two pending files can't both claim one username.
  const taken = new Set(users.map((u) => u.username.toLowerCase()));

  const accepted = [];
  for (const file of files) {
    let entry;
    try {
      entry = JSON.parse(fs.readFileSync(path.join(PENDING_DIR, file), "utf-8"));
    } catch {
      console.log(`Rejected ${file}: invalid JSON`);
      continue;
    }
    const error = validate(entry);
    if (error) {
      console.log(`Rejected ${file}: ${error}`);
      continue;
    }
    const username = entry.username.trim();
    if (taken.has(username.toLowerCase())) {
      console.log(`Rejected ${file}: username "${username}" already taken`);
      continue;
    }
    taken.add(username.toLowerCase());
    accepted.push({
      username,
      pin: entry.pin ? String(entry.pin).trim() : null,
      favoriteMember: entry.favoriteMember || null,
      armyType: entry.armyType || null,
      createdAt: new Date().toISOString().slice(0, 10),
    });
  }

  if (accepted.length > 0) {
    await writeJsonFile(
      "data/users.json",
      users.concat(accepted),
      sha,
      `Promote ${accepted.length} new user(s): ${accepted.map((u) => u.username).join(", ")}`,
      bobToken,
    );
    console.log(`Promoted ${accepted.length} user(s): ${accepted.map((u) => u.username).join(", ")}`);
  } else {
    console.log("No valid signups to promote.");
  }

  // Delete every processed file locally — accepted AND rejected — so
  // nothing is reprocessed. The workflow YAML commits the removal.
  for (const file of files) fs.unlinkSync(path.join(PENDING_DIR, file));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
