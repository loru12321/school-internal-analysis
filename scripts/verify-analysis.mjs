import { computeDatasetAnalysis, prepareDataset } from '../src/lib/analysis-engine.js';
import { createDemoDataset } from '../src/lib/demo-data.js';

const dataset = prepareDataset(createDemoDataset({ name: '验证学校' }));
const analysis = computeDatasetAnalysis(dataset);

if (!analysis.overview) {
  throw new Error('未生成总览数据');
}

if (analysis.classSummaries.length !== 3) {
  throw new Error(`班级数量异常，期望 3，实际 ${analysis.classSummaries.length}`);
}

if (!analysis.teacherSubjectOptions.length) {
  throw new Error('教师同学科比较没有生成学科选项');
}

if (analysis.studentProfiles.length !== dataset.students.length) {
  throw new Error('学生分析数量与原始学生数不一致');
}

if (!analysis.health) {
  throw new Error('数据体检结果未生成');
}

if (analysis.health.incompleteStudentCount !== 0) {
  throw new Error(`演示数据不应存在缺分学生，实际为 ${analysis.health.incompleteStudentCount}`);
}

if (analysis.health.totalMismatchCount !== 0) {
  throw new Error(`演示数据不应存在总分异常，实际为 ${analysis.health.totalMismatchCount}`);
}

if (analysis.health.missingTeacherAssignmentCount !== 0) {
  throw new Error(`演示数据不应缺少任课映射，实际为 ${analysis.health.missingTeacherAssignmentCount}`);
}

console.log('分析校验通过');
console.log(`学生数: ${analysis.overview.studentCount}`);
console.log(`班级数: ${analysis.overview.classCount}`);
console.log(`教师比较学科: ${analysis.teacherSubjectOptions.join('、')}`);
console.log(`数据体检: ${analysis.health.completeStudentCount} 名完整成绩`);
