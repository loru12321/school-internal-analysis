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

console.log('分析校验通过');
console.log(`学生数: ${analysis.overview.studentCount}`);
console.log(`班级数: ${analysis.overview.classCount}`);
console.log(`教师比较学科: ${analysis.teacherSubjectOptions.join('、')}`);
