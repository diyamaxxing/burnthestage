const fs = require("fs");
const path = require("path");

const MEMBERS = ["RM", "Jin", "Suga", "J-Hope", "Jimin", "V", "Jungkook"];
const DATA_OWNER = "diyamaxxing";
const DATA_REPO = "bestofbootcamp";
const PENDING_DIR = "pending";

function validate(entry) {
  if (!entry || typeof entry !== "object") return "not an object";
  if (typeof entry.username !== "string" || !entry.username.trim()) return "missing username";
  if (!/^[a-zA-Z0-9_]{3,20}$/.test(entry.username.trim())) return "invalid username format";
  if (entry.pin !== null && entry.pin !== undefined && typeof entry.pin !== "string") return "invalid pin";
  if (entry.favoriteMember && !MEMBERS.includes(entry.favoriteMember)) return "invalid favoriteMember";
  if (entry.armyType && !["new", "veteran"].includes(entry.armyType)) return "invalid armyType";
  return null;
}

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

  const dataFile = await githubRequest("contents/data/users.json?ref=main", bobToken);
  const users = JSON.parse(Buffer.from(dataFile.content, "base64").toString("utf-8"));
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

  // Remove all processed pending files (accepted or rejected) so they don't get reprocessed
  for (const file of files) {
    fs.unlinkSync(path.join(pendingDirPath, file));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
