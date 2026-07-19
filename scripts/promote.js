// ── Validate and promote pending signups ────────────────────────────────────
//
// Runs from .github/workflows/validate-and-promote.yml on every push that
// touches pending/. Each file under pending/ is one signup request written
// by btsbootcamp's js/auth.js (createUser()), using a token scoped only to
// THIS repo (burnthestage) — it has no access to bestofbootcamp or the site
// code, which is the entire reason this promotion step exists as a separate
// job with its OWN credential (BOB_TOKEN, scoped only to bestofbootcamp).
//
// What this does, in order:
//   1. Read every pending/*.json file from the checked-out working copy
//   2. Validate each one (well-formed JSON, matches the expected shape,
//      username not already taken in bestofbootcamp)
//   3. Batch all valid entries into ONE commit to bestofbootcamp/data/users.json
//   4. Delete every processed file locally — valid or not — so the workflow's
//      own "clean up pending files" step (in the YAML, not here) commits
//      their removal from burnthestage
//
// Full rationale for the two-repo/two-token split is in
// ARCHITECTURE_DECISIONS.md in the main btsbootcamp repo.

const fs = require("fs");
const path = require("path");

const MEMBERS = ["RM", "Jin", "Suga", "J-Hope", "Jimin", "V", "Jungkook"];
const DATA_OWNER = "diyamaxxing";
const DATA_REPO = "bestofbootcamp";
const PENDING_DIR = "pending";

// Structural validation only — checks shape, not whether the content is
// "good" (e.g. a well-formed but spammy username still passes). Catching
// that would need extra heuristics (rate limits, etc.), not implemented here.
// Must stay in sync with the USERNAME_PATTERN in btsbootcamp's js/auth.js —
// if the client accepts a username this rejects, every one of those
// signups will silently vanish from pending/ without ever reaching
// bestofbootcamp.
function validate(entry) {
  if (!entry || typeof entry !== "object") return "not an object";
  if (typeof entry.username !== "string" || !entry.username.trim()) return "missing username";
  if (!/^[a-zA-Z0-9_]{3,20}$/.test(entry.username.trim())) return "invalid username format";
  if (entry.pin !== null && entry.pin !== undefined && typeof entry.pin !== "string") return "invalid pin";
  if (entry.favoriteMember && !MEMBERS.includes(entry.favoriteMember)) return "invalid favoriteMember";
  if (entry.armyType && !["new", "veteran"].includes(entry.armyType)) return "invalid armyType";
  return null;
}

// Thin wrapper around the GitHub Contents API, always targeting
// bestofbootcamp. Every call here uses BOB_TOKEN — the credential that can
// ONLY write to that one repo, never burnthestage or the site code.
async function githubRequest(apiPath, token, options = {}) {
  const res = await fetch(`https://api.github.com/repos/${DATA_OWNER}/${DATA_REPO}/${apiPath}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      ...options.headers,
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`GitHub API ${res.status} on ${apiPath}: ${body}`);
  }
  return res.status === 204 ? null : res.json();
}

async function main() {
  const bobToken = process.env.BOB_TOKEN;
  if (!bobToken) throw new Error("BOB_TOKEN not set");

  const pendingDirPath = path.join(process.cwd(), PENDING_DIR);
  if (!fs.existsSync(pendingDirPath)) {
    console.log("No pending directory, nothing to do.");
    return;
  }

  const files = fs.readdirSync(pendingDirPath).filter((f) => f.endsWith(".json"));
  if (files.length === 0) {
    console.log("No pending submissions.");
    return;
  }

  // Fetch the CURRENT live users.json + its sha once per run. The sha is
  // required by the Contents API PUT below to prove we're updating the
  // version we just read (avoids silently clobbering a concurrent write).
  const dataFile = await githubRequest("contents/data/users.json?ref=main", bobToken);
  const users = JSON.parse(Buffer.from(dataFile.content, "base64").toString("utf-8"));

  // Tracks usernames across BOTH the existing live list and anything
  // accepted earlier in this same run — without this, two pending files
  // requesting the same username in one batch could both get promoted.
  const existingUsernames = new Set(users.map((u) => u.username.toLowerCase()));

  const accepted = [];

  for (const file of files) {
    const filePath = path.join(pendingDirPath, file);
    let entry;
    try {
      entry = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    } catch {
      console.log(`Rejected ${file}: invalid JSON`);
      continue;
    }

    const error = validate(entry);
    if (error) {
      console.log(`Rejected ${file}: ${error}`);
      continue;
    }

    const cleanUsername = entry.username.trim();
    if (existingUsernames.has(cleanUsername.toLowerCase())) {
      console.log(`Rejected ${file}: username "${cleanUsername}" already taken`);
      continue;
    }

    existingUsernames.add(cleanUsername.toLowerCase());
    accepted.push({
      username: cleanUsername,
      pin: entry.pin ? String(entry.pin).trim() : null,
      favoriteMember: entry.favoriteMember || null,
      armyType: entry.armyType || null,
      createdAt: new Date().toISOString().slice(0, 10),
    });
  }

  // One commit for the whole batch, not one per signup — fewer API calls,
  // and it means a run that processes several signups produces a single,
  // readable commit in bestofbootcamp's history instead of a flood of them.
  if (accepted.length > 0) {
    const updatedUsers = users.concat(accepted);
    const updatedContent = Buffer.from(JSON.stringify(updatedUsers, null, 2) + "\n", "utf-8").toString("base64");
    await githubRequest("contents/data/users.json", bobToken, {
      method: "PUT",
      body: JSON.stringify({
        message: `Promote ${accepted.length} new user(s): ${accepted.map((u) => u.username).join(", ")}`,
        content: updatedContent,
        sha: dataFile.sha,
        branch: "main",
      }),
    });
    console.log(`Promoted ${accepted.length} user(s): ${accepted.map((u) => u.username).join(", ")}`);
  } else {
    console.log("No valid submissions to promote.");
  }

  // Delete every processed file locally — accepted AND rejected — so
  // nothing gets reprocessed on the next run. This only touches the
  // checkout on disk; the workflow YAML's next step is what actually
  // commits the removal back to burnthestage.
  for (const file of files) {
    fs.unlinkSync(path.join(pendingDirPath, file));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
