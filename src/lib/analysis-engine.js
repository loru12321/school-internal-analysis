import {
  DEFAULT_METRIC_WEIGHTS,
  buildClassSubjectKey,
  cloneValue,
  computeRate,
  dedupeRows,
  inferFullMark,
  normalizeClass,
  normalizeSubject,
  normalizeText,
  round,
  sortAndRank,
  sortSubjects,
  toNumber,
  uid
} from './utils.js';

function buildThresholds(subjects, subjectFullMarks, totalFullMark, suppliedThresholds = {}) {
  const thresholds = {};
  subjects.forEach((subject) => {
    const fullMark = toNumber(subjectFullMarks[subject], inferFullMark(100));
    const supplied = suppliedThresholds?.[subject] || {};
    thresholds[subject] = {
      exc: toNumber(supplied.exc, round(fullMark * 0.85, 1)),
      pass: toNumber(supplied.pass, round(fullMark * 0.6, 1)),
      low: toNumber(supplied.low, round(fullMark * 0.4, 1))
    };
  });
  const suppliedTotal = suppliedThresholds?.total || {};
  thresholds.total = {
    exc: toNumber(suppliedTotal.exc, round(totalFullMark * 0.85, 1)),
    pass: toNumber(suppliedTotal.pass, round(totalFullMark * 0.6, 1)),
    low: toNumber(suppliedTotal.low, round(totalFullMark * 0.4, 1))
  };
  return thresholds;
}

function normalizeStudent(rawStudent, schoolName) {
  const scores = {};
  Object.entries(rawStudent?.scores || {}).forEach(([subject, score]) => {
    const normalizedSubject = normalizeSubject(subject);
    const numericScore = toNumber(score, NaN);
    if (!normalizedSubject || !Number.isFinite(numericScore)) return;
    scores[normalizedSubject] = numericScore;
  });

  const total = Number.isFinite(toNumber(rawStudent?.total, NaN))
    ? toNumber(rawStudent.total, 0)
    : Object.values(scores).reduce((sum, score) => sum + score, 0);

  return {
    id: rawStudent?.id || uid('stu'),
    name: normalizeText(rawStudent?.name),
    studentId: normalizeText(rawStudent?.studentId || rawStudent?.idCard || ''),
    className: normalizeClass(rawStudent?.className || rawStudent?.class || ''),
    schoolName: normalizeText(rawStudent?.schoolName || schoolName),
    examRoom: normalizeText(rawStudent?.examRoom || ''),
    scores,
    total
  };
}

function normalizeTeacherAssignments(rows) {
  return dedupeRows(
    (rows || []).map((row) => ({
      className: normalizeClass(row?.className || row?.class || ''),
      subject: normalizeSubject(row?.subject || ''),
      teacherName: normalizeText(row?.teacherName || row?.teacher || '')
    })).filter((row) => row.className && row.subject && row.teacherName),
    (row) => buildClassSubjectKey(row.className, row.subject)
  );
}

function enrichStudentRanks(students, subjects) {
  const nextStudents = students.map((student) => ({
    ...student,
    rank: 0,
    classRank: 0,
    subjectRanks: {},
    classSubjectRanks: {}
  }));

  const overallRanked = sortAndRank(nextStudents, (student) => student.total);
  const overallRankMap = new Map(overallRanked.map((student) => [student.id, student.rank]));
  const classBuckets = new Map();
  nextStudents.forEach((student) => {
    if (!classBuckets.has(student.className)) classBuckets.set(student.className, []);
    classBuckets.get(student.className).push(student);
  });

  const classRankMaps = new Map();
  classBuckets.forEach((rows, className) => {
    classRankMaps.set(
      className,
      new Map(sortAndRank(rows, (student) => student.total).map((student) => [student.id, student.rank]))
    );
  });

  const subjectRankMaps = new Map();
  const classSubjectRankMaps = new Map();
  subjects.forEach((subject) => {
    const subjectRows = nextStudents.filter((student) => Number.isFinite(student.scores[subject]));
    subjectRankMaps.set(
      subject,
      new Map(sortAndRank(subjectRows, (student) => student.scores[subject]).map((student) => [student.id, student.rank]))
    );

    classBuckets.forEach((rows, className) => {
      const key = `${className}__${subject}`;
      const filteredRows = rows.filter((student) => Number.isFinite(student.scores[subject]));
      classSubjectRankMaps.set(
        key,
        new Map(sortAndRank(filteredRows, (student) => student.scores[subject]).map((student) => [student.id, student.rank]))
      );
    });
  });

  return nextStudents.map((student) => {
    const subjectRanks = {};
    const classSubjectRanks = {};
    subjects.forEach((subject) => {
      subjectRanks[subject] = subjectRankMaps.get(subject)?.get(student.id) || null;
      classSubjectRanks[subject] = classSubjectRankMaps.get(`${student.className}__${subject}`)?.get(student.id) || null;
    });
    return {
      ...student,
      rank: overallRankMap.get(student.id) || null,
      classRank: classRankMaps.get(student.className)?.get(student.id) || null,
      subjectRanks,
      classSubjectRanks
    };
  });
}

function buildMetricSummary(scoreList, threshold) {
  const scores = (scoreList || []).map((score) => toNumber(score, NaN)).filter((score) => Number.isFinite(score));
  if (!scores.length) {
    return {
      count: 0,
      avg: 0,
      excellentRate: 0,
      passRate: 0,
      lowRate: 0,
      max: 0,
      min: 0
    };
  }
  return {
    count: scores.length,
    avg: scores.reduce((sum, score) => sum + score, 0) / scores.length,
    excellentRate: computeRate(scores.filter((score) => score >= threshold.exc).length, scores.length),
    passRate: computeRate(scores.filter((score) => score >= threshold.pass).length, scores.length),
    lowRate: computeRate(scores.filter((score) => score < threshold.low).length, scores.length),
    max: Math.max(...scores),
    min: Math.min(...scores)
  };
}

function sortClassNames(left, right) {
  return normalizeClass(left).localeCompare(normalizeClass(right), 'zh-Hans-CN');
}

function applyCompositeIndex(rows, weights = DEFAULT_METRIC_WEIGHTS) {
  if (!rows.length) return [];
  if (rows.length === 1) {
    rows[0].compositeIndex = 100;
    rows[0].rank = 1;
    return rows;
  }

  const maxAvg = Math.max(...rows.map((row) => row.avg), 1);
  const maxExcellent = Math.max(...rows.map((row) => row.excellentRate), 0.0001);
  const maxPass = Math.max(...rows.map((row) => row.passRate), 0.0001);

  const rankedRows = rows.map((row) => ({
    ...row,
    compositeIndex: round(
      (row.avg / maxAvg) * weights.avg
      + (row.excellentRate / maxExcellent) * weights.excellent
      + (row.passRate / maxPass) * weights.pass,
      2
    )
  })).sort((left, right) => right.compositeIndex - left.compositeIndex);

  return sortAndRank(rankedRows, (row) => row.compositeIndex);
}

function buildStudentStatus(total, totalThreshold) {
  if (total >= totalThreshold.exc) return '达优';
  if (total >= totalThreshold.pass) return '达线';
  if (totalThreshold.pass - total <= 15) return '临界';
  return '待提升';
}

function buildStudentInsight(student, gradeSubjectMap, classSummaryMap, dataset) {
  const strongestSubjects = [];
  const borderline = [];
  const classSummary = classSummaryMap.get(student.className);

  dataset.subjects.forEach((subject) => {
    const score = toNumber(student.scores[subject], NaN);
    if (!Number.isFinite(score)) return;
    const gradeAvg = gradeSubjectMap.get(subject)?.avg || 0;
    const classAvg = classSummary?.subjectMetricsMap.get(subject)?.avg || 0;
    const delta = round(score - gradeAvg, 1);
    const threshold = dataset.thresholds[subject];

    strongestSubjects.push({
      subject,
      score,
      delta,
      classDelta: round(score - classAvg, 1)
    });

    if (score < threshold.exc && threshold.exc - score <= 5) {
      borderline.push(`${subject} 距优秀线 ${round(threshold.exc - score, 1)} 分`);
    } else if (score < threshold.pass && threshold.pass - score <= 5) {
      borderline.push(`${subject} 距及格线 ${round(threshold.pass - score, 1)} 分`);
    }
  });

  strongestSubjects.sort((left, right) => right.delta - left.delta);
  const weakestSubjects = strongestSubjects.slice().sort((left, right) => left.delta - right.delta);

  return {
    ...student,
    status: buildStudentStatus(student.total, dataset.thresholds.total),
    strongestSubjects: strongestSubjects.slice(0, 2),
    weakestSubjects: weakestSubjects.slice(0, 2),
    borderline,
    totalGapToExc: round(dataset.thresholds.total.exc - student.total, 1),
    totalGapToPass: round(dataset.thresholds.total.pass - student.total, 1)
  };
}

function buildTeacherSummary(dataset, classBuckets) {
  const assignmentMap = new Map(
    dataset.teacherAssignments.map((row) => [buildClassSubjectKey(row.className, row.subject), row.teacherName])
  );
  const teacherBySubject = {};

  dataset.subjects.forEach((subject) => {
    const subjectBuckets = new Map();

    classBuckets.forEach((students, className) => {
      const teacherName = assignmentMap.get(buildClassSubjectKey(className, subject));
      if (!teacherName) return;
      const subjectScores = students
        .map((student) => student.scores[subject])
        .filter((score) => Number.isFinite(score));
      if (!subjectScores.length) return;

      const summary = buildMetricSummary(subjectScores, dataset.thresholds[subject]);
      if (!subjectBuckets.has(teacherName)) {
        subjectBuckets.set(teacherName, {
          key: `${subject}__${teacherName}`,
          teacherName,
          subject,
          classNames: [],
          scoreList: [],
          classBreakdown: [],
          studentCount: 0
        });
      }

      const bucket = subjectBuckets.get(teacherName);
      bucket.classNames.push(className);
      bucket.scoreList.push(...subjectScores);
      bucket.studentCount += subjectScores.length;
      bucket.classBreakdown.push({
        className,
        studentCount: subjectScores.length,
        avg: summary.avg,
        excellentRate: summary.excellentRate,
        passRate: summary.passRate,
        lowRate: summary.lowRate
      });
    });

    const rows = [...subjectBuckets.values()].map((bucket) => {
      const summary = buildMetricSummary(bucket.scoreList, dataset.thresholds[subject]);
      return {
        key: bucket.key,
        teacherName: bucket.teacherName,
        subject,
        classNames: bucket.classNames.sort(sortClassNames),
        classesText: bucket.classNames.join('、'),
        classCount: bucket.classNames.length,
        studentCount: bucket.studentCount,
        avg: summary.avg,
        excellentRate: summary.excellentRate,
        passRate: summary.passRate,
        lowRate: summary.lowRate,
        classBreakdown: bucket.classBreakdown.sort((left, right) => sortClassNames(left.className, right.className))
      };
    });

    teacherBySubject[subject] = applyCompositeIndex(rows);
  });

  return teacherBySubject;
}

function buildDatasetHealth(dataset, students, classBuckets) {
  const classNames = [...classBuckets.keys()].sort(sortClassNames);
  const assignmentMap = new Map(
    dataset.teacherAssignments.map((row) => [buildClassSubjectKey(row.className, row.subject), row.teacherName])
  );

  const expectedAssignments = classNames.flatMap((className) => dataset.subjects.map((subject) => ({
    key: buildClassSubjectKey(className, subject),
    className,
    subject
  })));

  const subjectCoverage = dataset.subjects.map((subject) => {
    const presentCount = students.filter((student) => Number.isFinite(student.scores[subject])).length;
    const missingCount = students.length - presentCount;
    return {
      subject,
      studentCount: students.length,
      presentCount,
      missingCount,
      coverageRate: computeRate(presentCount, students.length)
    };
  }).sort((left, right) => sortSubjects(left.subject, right.subject));

  const classSubjectCoverage = expectedAssignments.map(({ key, className, subject }) => {
    const classStudents = classBuckets.get(className) || [];
    const presentCount = classStudents.filter((student) => Number.isFinite(student.scores[subject])).length;
    const missingCount = classStudents.length - presentCount;
    return {
      className,
      subject,
      teacherName: assignmentMap.get(key) || '',
      studentCount: classStudents.length,
      presentCount,
      missingCount,
      coverageRate: computeRate(presentCount, classStudents.length)
    };
  }).sort((left, right) => sortClassNames(left.className, right.className) || sortSubjects(left.subject, right.subject));

  const incompleteStudents = students.map((student) => {
    const missingSubjects = dataset.subjects.filter((subject) => !Number.isFinite(student.scores[subject]));
    if (!missingSubjects.length) return null;
    return {
      id: student.id,
      name: student.name,
      className: student.className,
      studentId: student.studentId,
      missingSubjects,
      missingCount: missingSubjects.length
    };
  }).filter(Boolean).sort((left, right) => (
    right.missingCount - left.missingCount
    || sortClassNames(left.className, right.className)
    || left.name.localeCompare(right.name, 'zh-Hans-CN')
  ));

  const totalMismatchStudents = students.map((student) => {
    const computedTotal = round(
      dataset.subjects.reduce((sum, subject) => sum + (Number.isFinite(student.scores[subject]) ? student.scores[subject] : 0), 0),
      1
    );
    const delta = round(student.total - computedTotal, 1);
    if (Math.abs(delta) < 0.1) return null;
    return {
      id: student.id,
      name: student.name,
      className: student.className,
      studentId: student.studentId,
      recordedTotal: round(student.total, 1),
      computedTotal,
      delta
    };
  }).filter(Boolean).sort((left, right) => (
    Math.abs(right.delta) - Math.abs(left.delta)
    || sortClassNames(left.className, right.className)
    || left.name.localeCompare(right.name, 'zh-Hans-CN')
  ));

  const missingTeacherAssignments = expectedAssignments
    .filter((item) => !assignmentMap.has(item.key))
    .map(({ key, ...item }) => item)
    .sort((left, right) => sortClassNames(left.className, right.className) || sortSubjects(left.subject, right.subject));

  const redundantTeacherAssignments = dataset.teacherAssignments
    .filter((row) => !classBuckets.has(row.className) || !dataset.subjects.includes(row.subject))
    .sort((left, right) => sortClassNames(left.className, right.className) || sortSubjects(left.subject, right.subject));

  const completeStudentCount = students.length - incompleteStudents.length;
  const missingScoreEntriesCount = subjectCoverage.reduce((sum, row) => sum + row.missingCount, 0);
  const warningMessages = [];

  if (incompleteStudents.length) {
    warningMessages.push(`${incompleteStudents.length} 名学生存在缺科或缺分记录`);
  }
  if (totalMismatchStudents.length) {
    warningMessages.push(`${totalMismatchStudents.length} 名学生总分与分科合计不一致`);
  }
  if (missingTeacherAssignments.length) {
    warningMessages.push(`${missingTeacherAssignments.length} 个班级学科尚未绑定任课教师`);
  }
  if (redundantTeacherAssignments.length) {
    warningMessages.push(`${redundantTeacherAssignments.length} 条任课记录未匹配到有效成绩班级`);
  }

  return {
    completeStudentCount,
    completeStudentRate: computeRate(completeStudentCount, students.length),
    incompleteStudentCount: incompleteStudents.length,
    missingScoreEntriesCount,
    totalMismatchCount: totalMismatchStudents.length,
    missingTeacherAssignmentCount: missingTeacherAssignments.length,
    redundantTeacherAssignmentCount: redundantTeacherAssignments.length,
    teacherCoverageRate: expectedAssignments.length
      ? computeRate(expectedAssignments.length - missingTeacherAssignments.length, expectedAssignments.length)
      : 1,
    subjectCoverage,
    classSubjectCoverage,
    incompleteStudents,
    totalMismatchStudents,
    missingTeacherAssignments,
    redundantTeacherAssignments,
    warningMessages
  };
}

export function prepareDataset(rawDataset) {
  const schoolName = normalizeText(rawDataset?.schoolName || '本校');
  const normalizedStudents = (rawDataset?.students || [])
    .map((student) => normalizeStudent(student, schoolName))
    .filter((student) => student.name && student.className && Object.keys(student.scores).length);

  const subjects = [...new Set(normalizedStudents.flatMap((student) => Object.keys(student.scores)))]
    .map((subject) => normalizeSubject(subject))
    .sort(sortSubjects);

  const subjectFullMarks = subjects.reduce((collector, subject) => {
    const supplied = toNumber(rawDataset?.subjectFullMarks?.[subject], NaN);
    if (Number.isFinite(supplied) && supplied > 0) {
      collector[subject] = supplied;
      return collector;
    }
    const maxScore = Math.max(...normalizedStudents.map((student) => toNumber(student.scores[subject], 0)), 0);
    collector[subject] = inferFullMark(maxScore);
    return collector;
  }, {});

  const totalFullMark = subjects.reduce((sum, subject) => sum + toNumber(subjectFullMarks[subject], 0), 0);
  const thresholds = buildThresholds(subjects, subjectFullMarks, totalFullMark, rawDataset?.thresholds || {});
  const studentsWithRank = enrichStudentRanks(normalizedStudents, subjects);

  return {
    id: normalizeText(rawDataset?.id || uid('exam')),
    schoolName,
    gradeName: normalizeText(rawDataset?.gradeName || '未命名年级'),
    termName: normalizeText(rawDataset?.termName || ''),
    examName: normalizeText(rawDataset?.examName || '未命名考试'),
    examDate: normalizeText(rawDataset?.examDate || ''),
    subjectFullMarks,
    totalFullMark,
    thresholds,
    subjects,
    students: studentsWithRank,
    teacherAssignments: normalizeTeacherAssignments(rawDataset?.teacherAssignments || []),
    createdAt: normalizeText(rawDataset?.createdAt || new Date().toISOString()),
    updatedAt: normalizeText(rawDataset?.updatedAt || new Date().toISOString())
  };
}

export function computeDatasetAnalysis(datasetInput) {
  const dataset = cloneValue(datasetInput);
  const students = dataset.students || [];
  if (!students.length) {
    return {
      overview: null,
      subjectSummaries: [],
      classSummaries: [],
      classSummaryMap: new Map(),
      gradeSubjectMap: new Map(),
      studentProfiles: [],
      teacherBySubject: {},
      teacherSubjectOptions: [],
      health: null
    };
  }

  const classBuckets = new Map();
  students.forEach((student) => {
    if (!classBuckets.has(student.className)) classBuckets.set(student.className, []);
    classBuckets.get(student.className).push(student);
  });

  const gradeTotalSummary = buildMetricSummary(students.map((student) => student.total), dataset.thresholds.total);
  const gradeSubjectMap = new Map();
  const subjectSummaries = dataset.subjects.map((subject) => {
    const summary = buildMetricSummary(
      students.map((student) => student.scores[subject]).filter((score) => Number.isFinite(score)),
      dataset.thresholds[subject]
    );
    const row = {
      subject,
      fullMark: dataset.subjectFullMarks[subject],
      avg: summary.avg,
      excellentRate: summary.excellentRate,
      passRate: summary.passRate,
      lowRate: summary.lowRate,
      studentCount: summary.count
    };
    gradeSubjectMap.set(subject, row);
    return row;
  }).sort((left, right) => sortSubjects(left.subject, right.subject));

  const classSummaryRows = [...classBuckets.entries()].map(([className, classStudents]) => {
    const totalSummary = buildMetricSummary(classStudents.map((student) => student.total), dataset.thresholds.total);
    const subjectMetrics = dataset.subjects.map((subject) => {
      const summary = buildMetricSummary(
        classStudents.map((student) => student.scores[subject]).filter((score) => Number.isFinite(score)),
        dataset.thresholds[subject]
      );
      return {
        subject,
        avg: summary.avg,
        excellentRate: summary.excellentRate,
        passRate: summary.passRate,
        lowRate: summary.lowRate,
        avgDelta: round(summary.avg - (gradeSubjectMap.get(subject)?.avg || 0), 1)
      };
    });

    return {
      key: className,
      className,
      studentCount: classStudents.length,
      avg: totalSummary.avg,
      excellentRate: totalSummary.excellentRate,
      passRate: totalSummary.passRate,
      lowRate: totalSummary.lowRate,
      subjectMetrics,
      topStudent: sortAndRank(classStudents, (student) => student.total)[0]?.name || '-'
    };
  });

  const classSummaries = applyCompositeIndex(classSummaryRows);
  const classSummaryMap = new Map(
    classSummaries.map((summary) => [
      summary.className,
      {
        ...summary,
        subjectMetricsMap: new Map(summary.subjectMetrics.map((metric) => [metric.subject, metric]))
      }
    ])
  );

  const studentProfiles = students
    .map((student) => buildStudentInsight(student, gradeSubjectMap, classSummaryMap, dataset))
    .sort((left, right) => left.rank - right.rank);

  const teacherBySubject = buildTeacherSummary(dataset, classBuckets);
  const teacherSubjectOptions = Object.keys(teacherBySubject)
    .filter((subject) => teacherBySubject[subject]?.length)
    .sort(sortSubjects);
  const health = buildDatasetHealth(dataset, students, classBuckets);

  return {
    overview: {
      schoolName: dataset.schoolName,
      gradeName: dataset.gradeName,
      examName: dataset.examName,
      examDate: dataset.examDate,
      studentCount: students.length,
      classCount: classBuckets.size,
      subjectCount: dataset.subjects.length,
      avgTotal: gradeTotalSummary.avg,
      excellentRate: gradeTotalSummary.excellentRate,
      passRate: gradeTotalSummary.passRate,
      lowRate: gradeTotalSummary.lowRate,
      formulaText: '综合指数 = 平均分 × 40 + 优秀率 × 30 + 及格率 × 30（按校内最优归一化）'
    },
    subjectSummaries,
    classSummaries,
    classSummaryMap,
    gradeSubjectMap,
    studentProfiles,
    teacherBySubject,
    teacherSubjectOptions,
    health
  };
}

export function exportDatasetSnapshot(dataset) {
  return cloneValue(dataset);
}
