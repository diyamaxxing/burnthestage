// ── Minimal GitHub Contents API helper, always targeting bestofbootcamp ─────
//
// Every call here uses BOB_TOKEN — a fine-grained PAT with Contents:write on
// diyamaxxing/bestofbootcamp ONLY, never burnthestage or the site code.
// This is the credential that carries data across the trust boundary
// (untrusted ingress → canonical state), so it is deliberately the
// narrowest possible.

const DATA_OWNER = "diyamaxxing";
const DATA_REPO = "bestofbootcamp";

async function githubRequest(apiPath, token, options = {}) {
  const res = await fetch(`https://api.github.com/repos/${DATA_OWNER}/${DATA_REPO}/${apiPath}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "burnthestage-promote",
      ...options.headers,
    },
  });
  if (!res.ok) {
    throw new Error(`GitHub API ${res.status} on ${apiPath}: ${await res.text()}`);
  }
  return res.status === 204 ? null : res.json();
}

// Reads a JSON file from bestofbootcamp@main, returning both the parsed
// content and its blob sha (the sha is required by a follow-up PUT to prove
// you're updating the version you just read).
async function readJsonFile(path, token) {
  const file = await githubRequest(`contents/${path}?ref=main`, token);
  const content = JSON.parse(Buffer.from(file.content, "base64").toString("utf-8"));
  return { content, sha: file.sha };
}

// Writes a JSON value back to bestofbootcamp@main as one commit.
async function writeJsonFile(path, value, sha, message, token) {
  const encoded = Buffer.from(JSON.stringify(value, null, 2) + "\n", "utf-8").toString("base64");
  await githubRequest(`contents/${path}`, token, {
    method: "PUT",
    body: JSON.stringify({ message, content: encoded, sha, branch: "main" }),
  });
}

module.exports = { DATA_OWNER, DATA_REPO, githubRequest, readJsonFile, writeJsonFile };
