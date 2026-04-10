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

CREATE INDEX IF NOT EXISTS idx_analysis_datasets_updated_at
  ON analysis_datasets(updated_at DESC);
