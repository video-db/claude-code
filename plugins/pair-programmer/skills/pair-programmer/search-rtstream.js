#!/usr/bin/env node
/**
 * VideoDB RTStream Search
 *
 * Searches indexed RTStream content via VideoDB's semantic search.
 * Reads session info from /tmp/videodb_pp_info.json for RTStream IDs.
 *
 * Usage:
 *   node search-rtstream.js --query="your search query" --cwd=/path/to/project [--rtstream=rts-xxx]
 *
 * Output: JSON array to stdout
 *   [{ "text": "...", "start": ..., "end": ..., "rtstream_id": "...", "rtstream_name": "...", "score": ... }]
 */

const path = require("path");
const fs = require("fs");
const dotenv = require("dotenv");
const { connect } = require("videodb");

const INFO_FILE = "/tmp/videodb_pp_info.json";

const args = {};
for (const arg of process.argv.slice(2)) {
  const match = arg.match(/^--(\w+)=(.+)$/);
  if (match) args[match[1]] = match[2];
}

if (!args.query) {
  console.error("Usage: node search-rtstream.js --query=\"...\" --cwd=/path [--rtstream=rts-xxx]");
  process.exit(1);
}

// Load .env and pp.config.json from user's project directory (same as recorder-app.js)
const userCwd = args.cwd || null;
if (userCwd) {
  dotenv.config({ path: path.join(userCwd, ".env") });
}

function loadProjectConfig() {
  const configPath = userCwd ? path.join(userCwd, "pp.config.json") : null;
  if (!configPath) return {};
  try {
    return JSON.parse(fs.readFileSync(configPath, "utf-8"));
  } catch (_) {
    return {};
  }
}

const PROJECT_CONFIG = loadProjectConfig();
const API_KEY = process.env.VIDEO_DB_API_KEY;
const BASE_URL = PROJECT_CONFIG.videodb_backend_url || process.env.VIDEO_DB_BASE_URL || "https://api.videodb.io";

if (!API_KEY) {
  console.error("VIDEO_DB_API_KEY not set");
  process.exit(1);
}

function loadSessionInfo() {
  try {
    return JSON.parse(fs.readFileSync(INFO_FILE, "utf-8"));
  } catch (_) {
    return null;
  }
}

async function main() {
  const sessionInfo = loadSessionInfo();
  if (!sessionInfo) {
    console.error("No session info found at " + INFO_FILE);
    process.exit(1);
  }

  const conn = connect({ apiKey: API_KEY, baseUrl: BASE_URL });
  const coll = await conn.getCollection();

  let results;

  if (args.rtstream) {
    const rtstream = await coll.getRTStream(args.rtstream);
    results = await rtstream.search(args.query);
  } else {
    results = await coll.search(args.query, { namespace: "rtstream" });
  }

  const shots = results.getShots ? results.getShots() : results.shots || results;

  const output = (Array.isArray(shots) ? shots : []).map(shot => ({
    text: shot.text || "",
    start: shot.start || null,
    end: shot.end || null,
    rtstream_id: shot.rtstream_id || shot.video_id || "",
    rtstream_name: shot.rtstream_name || shot.video_title || "",
    score: shot.search_score || shot.score || null,
  }));

  console.log(JSON.stringify(output, null, 2));
}

main().catch(err => {
  console.error("Search failed:", err.message);
  process.exit(1);
});
