// ── Validate and promote pending COMMENTS ──────────────────────────────────
//
// Same trust-boundary role as promote.js (signups): files under
// pending/comments/ are written by the btsbootcamp-fanmail Lambda (App
// scoped only to burnthestage); this job re-validates them and promotes
// accepted ones into bestofbootcamp/data/comments.json using BOB_TOKEN
// (scoped only to bestofbootcamp).
//
// V1 comment scope (matches btsbootcamp #15): flat, per-video comments.
// No parent_comment_id (any non-null value is rejected), no interval
// bucketing, no likes. comment_id and posted_at are assigned HERE, never
// trusted from the submission.

const fs = require("fs");
const path = require("path");
const { readJsonFile, writeJsonFile } = require("./lib/github");

const MAX_COMMENT_LENGTH = 2000;
const VIDEO_ID_PATTERN = /^[a-zA-Z0-9_-]{1,64}$/;
const PENDING_DIR = path.join(process.cwd(), "pending", "comments");

// Must stay in sync with btsbootcamp's lambda/fanmail/index.mjs and
// lib/comments.ts. The username-has-a-real-profile check is done HERE (not
// at the Lambda) because it needs bestofbootcamp's live users.json.
function validate(entry, knownUsernames) {
  if (!entry || typeof entry !== "object") return "not an object";

  const videoId = typeof entry.video_id === "string" ? entry.video_id.trim() : "";
  if (!videoId) return "missing video_id";
  if (!VIDEO_ID_PATTERN.test(videoId)) return "invalid video_id format";

  const username = typeof entry.username === "string" ? entry.username.trim() : "";
  if (!username) return "missing username";
  if (!knownUsernames.has(username.toLowerCase())) return `no profile for username "${username}"`;

  const comment = typeof entry.comment === "string" ? entry.comment.trim() : "";
  if (!comment) return "missing comment";
  if (comment.length > MAX_COMMENT_LENGTH) return "comment too long";

  if (entry.parent_comment_id != null) return "replies not supported in V1";

  return null;
}

async function main() {
  const bobToken = process.env.BOB_TOKEN;
  if (!bobToken) throw new Error("BOB_TOKEN not set");

  if (!fs.existsSync(PENDING_DIR)) {
    console.log("No pending/comments directory, nothing to do.");
    return;
  }
  const files = fs.readdirSync(PENDING_DIR).filter((f) => f.endsWith(".json"));
  if (files.length === 0) {
    console.log("No pending comments.");
    return;
  }

  const { content: users } = await readJsonFile("data/users.json", bobToken);
  const knownUsernames = new Set(users.map((u) => u.username.toLowerCase()));
  const { content: comments, sha } = await readJsonFile("data/comments.json", bobToken);

  const now = new Date().toISOString();
  const accepted = [];

  files.forEach((file, i) => {
    let entry;
    try {
      entry = JSON.parse(fs.readFileSync(path.join(PENDING_DIR, file), "utf-8"));
    } catch {
      console.log(`Rejected ${file}: invalid JSON`);
      return;
    }
    const error = validate(entry, knownUsernames);
    if (error) {
      console.log(`Rejected ${file}: ${error}`);
      return;
    }
    const videoId = entry.video_id.trim();
    accepted.push({
      comment_id: `${videoId}-${Date.now()}-${i}`,
      parent_comment_id: null,
      video_id: videoId,
      username: entry.username.trim(),
      comment: entry.comment.trim(),
      posted_at: now,
    });
  });

  if (accepted.length > 0) {
    const videos = [...new Set(accepted.map((c) => c.video_id))].join(", ");
    await writeJsonFile(
      "data/comments.json",
      comments.concat(accepted),
      sha,
      `Promote ${accepted.length} new comment(s) on: ${videos}`,
      bobToken,
    );
    console.log(`Promoted ${accepted.length} comment(s) on: ${videos}`);
  } else {
    console.log("No valid comments to promote.");
  }

  for (const file of files) fs.unlinkSync(path.join(PENDING_DIR, file));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
