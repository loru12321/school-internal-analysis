var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// worker/index.js
function jsonResponse(data, init = {}) {
  return new Response(JSON.stringify(data), {
    headers: {
      "content-type": "application/json;charset=utf-8",
      "cache-control": "no-store"
    },
    ...init
  });
}
__name(jsonResponse, "jsonResponse");
function buildCorsHeaders() {
  return {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET,POST,DELETE,OPTIONS",
    "access-control-allow-headers": "content-type"
  };
}
__name(buildCorsHeaders, "buildCorsHeaders");
function parseBody(request) {
  return request.json().catch(() => ({}));
}
__name(parseBody, "parseBody");
async function ensureTables(env) {
  await env.DB.exec(`
    CREATE TABLE IF NOT EXISTS school_profile (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL DEFAULT '',
      stage TEXT NOT NULL DEFAULT '',
      note TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS analysis_datasets (
      id TEXT PRIMARY KEY,
      school_name TEXT NOT NULL DEFAULT '',
      grade_name TEXT NOT NULL DEFAULT '',
      term_name TEXT NOT NULL DEFAULT '',
      exam_name TEXT NOT NULL DEFAULT '',
      exam_date TEXT NOT NULL DEFAULT '',
      student_count INTEGER NOT NULL DEFAULT 0,
      subject_count INTEGER NOT NULL DEFAULT 0,
      payload_json TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);
}
__name(ensureTables, "ensureTables");
async function handleProfile(request, env) {
  if (request.method === "GET") {
    const result = await env.DB.prepare("SELECT id, name, stage, note, updated_at FROM school_profile WHERE id = ?").bind("default").first();
    return jsonResponse({ item: result || null });
  }
  const body = await parseBody(request);
  const updatedAt = (/* @__PURE__ */ new Date()).toISOString();
  await env.DB.prepare(`
    INSERT INTO school_profile (id, name, stage, note, updated_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      stage = excluded.stage,
      note = excluded.note,
      updated_at = excluded.updated_at
  `).bind(
    "default",
    String(body.name || ""),
    String(body.stage || ""),
    String(body.note || ""),
    updatedAt
  ).run();
  return jsonResponse({
    item: {
      id: "default",
      name: String(body.name || ""),
      stage: String(body.stage || ""),
      note: String(body.note || ""),
      updatedAt
    }
  });
}
__name(handleProfile, "handleProfile");
async function listDatasets(env) {
  const result = await env.DB.prepare(`
    SELECT id, school_name, grade_name, term_name, exam_name, exam_date, student_count, subject_count, updated_at, created_at
    FROM analysis_datasets
    ORDER BY updated_at DESC
  `).all();
  const items = (result.results || []).map((row) => ({
    id: row.id,
    schoolName: row.school_name,
    gradeName: row.grade_name,
    termName: row.term_name,
    examName: row.exam_name,
    examDate: row.exam_date,
    studentCount: row.student_count,
    subjectCount: row.subject_count,
    updatedAt: row.updated_at,
    createdAt: row.created_at
  }));
  return jsonResponse({ items });
}
__name(listDatasets, "listDatasets");
async function saveDataset(request, env) {
  const body = await parseBody(request);
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const payload = JSON.stringify(body);
  await env.DB.prepare(`
    INSERT INTO analysis_datasets (
      id, school_name, grade_name, term_name, exam_name, exam_date,
      student_count, subject_count, payload_json, updated_at, created_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      school_name = excluded.school_name,
      grade_name = excluded.grade_name,
      term_name = excluded.term_name,
      exam_name = excluded.exam_name,
      exam_date = excluded.exam_date,
      student_count = excluded.student_count,
      subject_count = excluded.subject_count,
      payload_json = excluded.payload_json,
      updated_at = excluded.updated_at
  `).bind(
    String(body.id || ""),
    String(body.schoolName || ""),
    String(body.gradeName || ""),
    String(body.termName || ""),
    String(body.examName || ""),
    String(body.examDate || ""),
    Array.isArray(body.students) ? body.students.length : 0,
    Array.isArray(body.subjects) ? body.subjects.length : 0,
    payload,
    now,
    String(body.createdAt || now)
  ).run();
  return jsonResponse({ ok: true, updatedAt: now });
}
__name(saveDataset, "saveDataset");
async function readDataset(datasetId, env) {
  const row = await env.DB.prepare("SELECT payload_json FROM analysis_datasets WHERE id = ?").bind(datasetId).first();
  if (!row) {
    return jsonResponse({ error: "\u672A\u627E\u5230\u8BE5\u8003\u8BD5" }, { status: 404 });
  }
  return jsonResponse({ item: JSON.parse(row.payload_json) });
}
__name(readDataset, "readDataset");
async function deleteDataset(datasetId, env) {
  await env.DB.prepare("DELETE FROM analysis_datasets WHERE id = ?").bind(datasetId).run();
  return new Response(null, {
    status: 204,
    headers: buildCorsHeaders()
  });
}
__name(deleteDataset, "deleteDataset");
async function handleApi(request, env, url) {
  await ensureTables(env);
  if (request.method === "OPTIONS") {
    return new Response(null, { headers: buildCorsHeaders() });
  }
  if (url.pathname === "/api/health") {
    return jsonResponse({
      ok: true,
      message: "Cloudflare Worker \u4E0E D1 \u5DF2\u5C31\u7EEA\u3002",
      timestamp: (/* @__PURE__ */ new Date()).toISOString()
    });
  }
  if (url.pathname === "/api/profile") {
    return handleProfile(request, env);
  }
  if (url.pathname === "/api/datasets" && request.method === "GET") {
    return listDatasets(env);
  }
  if (url.pathname === "/api/datasets" && request.method === "POST") {
    return saveDataset(request, env);
  }
  const match = url.pathname.match(/^\/api\/datasets\/([^/]+)$/);
  if (match) {
    const datasetId = decodeURIComponent(match[1]);
    if (request.method === "GET") return readDataset(datasetId, env);
    if (request.method === "DELETE") return deleteDataset(datasetId, env);
  }
  return jsonResponse({ error: "\u672A\u627E\u5230\u63A5\u53E3" }, { status: 404 });
}
__name(handleApi, "handleApi");
var index_default = {
  async fetch(request, env) {
    const url = new URL(request.url);
    const corsHeaders = buildCorsHeaders();
    if (url.pathname.startsWith("/api/")) {
      const response = await handleApi(request, env, url);
      const nextHeaders = new Headers(response.headers);
      Object.entries(corsHeaders).forEach(([key, value]) => nextHeaders.set(key, value));
      return new Response(response.body, {
        status: response.status,
        headers: nextHeaders
      });
    }
    if (env.ASSETS) {
      const assetResponse = await env.ASSETS.fetch(request);
      if (assetResponse.status !== 404) return assetResponse;
      return env.ASSETS.fetch(new Request(new URL("/index.html", request.url), request));
    }
    return new Response("Missing ASSETS binding", { status: 500 });
  }
};
export {
  index_default as default
};
//# sourceMappingURL=index.js.map
