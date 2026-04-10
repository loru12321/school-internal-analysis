import {
  buildClassSubjectKey,
  dedupeRows,
  normalizeClass,
  normalizeLooseText,
  normalizeSubject,
  normalizeText,
  toNumber,
  uid
} from './utils.js';

const SCORE_COLUMN_ALIASES = {
  name: ['姓名', '学生姓名', '考生姓名', 'name'],
  studentId: ['学号', '考号', '准考证号', 'id'],
  className: ['班级', '行政班', '教学班', 'class'],
  total: ['总分', '合计', '总成绩', 'total'],
  examRoom: ['考场', '考室', 'room']
};

const TEACHER_COLUMN_ALIASES = {
  className: ['班级', '行政班', '教学班', 'class'],
  subject: ['学科', '科目', '任教科目', 'subject'],
  teacherName: ['教师', '教师姓名', '任课教师', '任课老师', 'teacher']
};

const SUBJECT_HINTS = ['语文', '数学', '英语', '物理', '化学', '政治', '道法', '历史', '地理', '生物', '科学'];

function cellToPlain(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'object') {
    if (Array.isArray(value.richText)) return value.richText.map((item) => item.text || '').join('');
    if (value.text) return value.text;
    if (value.result !== undefined) return value.result;
    if (value.hyperlink) return value.text || value.hyperlink;
  }
  return String(value);
}

function parseCsv(text) {
  const rows = [];
  let current = '';
  let row = [];
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const nextChar = text[index + 1];

    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        current += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === ',' && !inQuotes) {
      row.push(current);
      current = '';
      continue;
    }

    if ((char === '\n' || char === '\r') && !inQuotes) {
      if (char === '\r' && nextChar === '\n') index += 1;
      row.push(current);
      current = '';
      if (row.some((cell) => normalizeText(cell))) rows.push(row);
      row = [];
      continue;
    }

    current += char;
  }

  row.push(current);
  if (row.some((cell) => normalizeText(cell))) rows.push(row);
  return rows;
}

function worksheetToMatrix(worksheet) {
  const matrix = [];
  worksheet.eachRow({ includeEmpty: false }, (row) => {
    const values = row.values.slice(1).map(cellToPlain);
    if (values.some((cell) => normalizeText(cell))) matrix.push(values);
  });
  return matrix;
}

async function readWorkbookRows(file) {
  const fileName = normalizeText(file?.name || '');
  if (fileName.toLowerCase().endsWith('.csv')) {
    const text = await file.text();
    return [{ name: fileName.replace(/\.csv$/i, ''), matrix: parseCsv(text) }];
  }

  const ExcelJS = (await import('exceljs')).default;
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(await file.arrayBuffer());
  const sheets = [];
  workbook.eachSheet((worksheet) => {
    sheets.push({
      name: worksheet.name,
      matrix: worksheetToMatrix(worksheet)
    });
  });
  return sheets;
}

function scoreHeaderScore(row) {
  if (!row?.length) return 0;
  let score = 0;
  const cells = row.map(normalizeLooseText);
  Object.values(SCORE_COLUMN_ALIASES).forEach((aliases) => {
    if (aliases.some((alias) => cells.some((cell) => cell.includes(normalizeLooseText(alias))))) score += 2;
  });
  const subjectHits = cells.filter((cell) => SUBJECT_HINTS.some((subject) => cell.includes(normalizeLooseText(subject)))).length;
  return score + subjectHits;
}

function teacherHeaderScore(row) {
  if (!row?.length) return 0;
  let score = 0;
  const cells = row.map(normalizeLooseText);
  Object.values(TEACHER_COLUMN_ALIASES).forEach((aliases) => {
    if (aliases.some((alias) => cells.some((cell) => cell.includes(normalizeLooseText(alias))))) score += 3;
  });
  return score;
}

function detectHeaderRow(matrix, mode = 'score') {
  let bestIndex = -1;
  let bestScore = 0;
  const detector = mode === 'teacher' ? teacherHeaderScore : scoreHeaderScore;
  matrix.slice(0, 10).forEach((row, index) => {
    const score = detector(row);
    if (score > bestScore) {
      bestScore = score;
      bestIndex = index;
    }
  });
  return bestIndex;
}

function matchColumnIndex(headers, aliases) {
  const normalizedAliases = aliases.map(normalizeLooseText);
  return headers.findIndex((header) => normalizedAliases.some((alias) => normalizeLooseText(header).includes(alias)));
}

function buildScoreColumns(headers) {
  const columns = {
    name: matchColumnIndex(headers, SCORE_COLUMN_ALIASES.name),
    studentId: matchColumnIndex(headers, SCORE_COLUMN_ALIASES.studentId),
    className: matchColumnIndex(headers, SCORE_COLUMN_ALIASES.className),
    total: matchColumnIndex(headers, SCORE_COLUMN_ALIASES.total),
    examRoom: matchColumnIndex(headers, SCORE_COLUMN_ALIASES.examRoom),
    scores: []
  };

  headers.forEach((header, index) => {
    const subject = normalizeSubject(header);
    if (!subject || !SUBJECT_HINTS.some((hint) => normalizeLooseText(header).includes(normalizeLooseText(hint)))) return;
    if (columns.scores.some((item) => item.subject === subject)) return;
    columns.scores.push({ subject, index });
  });

  return columns;
}

export async function parseScoreWorkbook(file) {
  const sheets = await readWorkbookRows(file);
  const students = [];

  sheets.forEach(({ name, matrix }) => {
    if (!matrix.length) return;
    const headerIndex = detectHeaderRow(matrix, 'score');
    if (headerIndex === -1) return;
    const headers = matrix[headerIndex].map(normalizeText);
    const columns = buildScoreColumns(headers);
    if (columns.name === -1 || (!columns.scores.length && columns.total === -1)) return;

    matrix.slice(headerIndex + 1).forEach((row, rowIndex) => {
      const nameValue = normalizeText(row[columns.name]);
      if (!nameValue) return;

      const classValue = columns.className === -1
        ? normalizeClass(name)
        : normalizeClass(row[columns.className]);
      if (!classValue) return;

      const scores = {};
      columns.scores.forEach(({ subject, index }) => {
        const score = toNumber(row[index], NaN);
        if (Number.isFinite(score)) scores[subject] = score;
      });

      const computedTotal = columns.total !== -1
        ? toNumber(row[columns.total], NaN)
        : Object.values(scores).reduce((sum, score) => sum + score, 0);

      students.push({
        id: uid('stu'),
        name: nameValue,
        studentId: columns.studentId === -1 ? `${name}-${rowIndex}` : normalizeText(row[columns.studentId]),
        className: classValue,
        examRoom: columns.examRoom === -1 ? '' : normalizeText(row[columns.examRoom]),
        scores,
        total: Number.isFinite(computedTotal) ? computedTotal : Object.values(scores).reduce((sum, score) => sum + score, 0)
      });
    });
  });

  return { students };
}

export async function parseTeacherWorkbook(file) {
  const sheets = await readWorkbookRows(file);
  const rows = [];

  sheets.forEach(({ matrix }) => {
    if (!matrix.length) return;
    const headerIndex = detectHeaderRow(matrix, 'teacher');
    if (headerIndex === -1) return;
    const headers = matrix[headerIndex].map(normalizeText);

    const classIndex = matchColumnIndex(headers, TEACHER_COLUMN_ALIASES.className);
    const subjectIndex = matchColumnIndex(headers, TEACHER_COLUMN_ALIASES.subject);
    const teacherIndex = matchColumnIndex(headers, TEACHER_COLUMN_ALIASES.teacherName);
    if (classIndex === -1 || subjectIndex === -1 || teacherIndex === -1) return;

    matrix.slice(headerIndex + 1).forEach((row) => {
      const className = normalizeClass(row[classIndex]);
      const subject = normalizeSubject(row[subjectIndex]);
      const teacherName = normalizeText(row[teacherIndex]);
      if (!className || !subject || !teacherName) return;
      rows.push({ className, subject, teacherName });
    });
  });

  return dedupeRows(rows, (row) => buildClassSubjectKey(row.className, row.subject));
}
