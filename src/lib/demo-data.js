import { uid } from './utils.js';

const SUBJECTS = ['语文', '数学', '英语', '物理', '化学'];
const SUBJECT_FULL_MARKS = {
  语文: 120,
  数学: 120,
  英语: 120,
  物理: 80,
  化学: 70
};

const SURNAME_POOL = ['王', '李', '张', '刘', '陈', '杨', '赵', '黄', '周', '吴', '徐', '孙', '胡', '朱', '郭', '马'];
const GIVEN_POOL = ['子涵', '欣怡', '梓轩', '宇航', '思远', '若曦', '浩然', '欣妍', '晨曦', '博文', '瑾瑜', '奕辰', '佳宁', '嘉悦', '泽宇', '诗涵'];

const SUBJECT_TEACHERS = {
  语文: ['李萍', '王琳', '赵敏'],
  数学: ['陈涛', '周宁', '徐慧'],
  英语: ['张静', '孙洁', '吴倩'],
  物理: ['刘强', '郭鹏', '马骏'],
  化学: ['胡敏', '朱倩', '杨涛']
};

const CLASS_BIASES = {
  '1班': 8,
  '2班': 1,
  '3班': -6
};

const SUBJECT_BIASES = {
  '1班': { 语文: 4, 数学: 6, 英语: 1, 物理: 3, 化学: 1 },
  '2班': { 语文: 1, 数学: 0, 英语: 5, 物理: 1, 化学: 2 },
  '3班': { 语文: -2, 数学: -4, 英语: 0, 物理: -3, 化学: -1 }
};

function pseudoRandom(seed) {
  const value = Math.sin(seed * 12.9898) * 43758.5453;
  return value - Math.floor(value);
}

function createStudentName(index) {
  const surname = SURNAME_POOL[index % SURNAME_POOL.length];
  const given = GIVEN_POOL[(index * 3) % GIVEN_POOL.length];
  return `${surname}${given}`;
}

function buildScore(seed, fullMark, bias) {
  const fluctuation = (pseudoRandom(seed) - 0.5) * 24;
  const score = Math.round(Math.max(28, Math.min(fullMark, fullMark * 0.72 + bias + fluctuation)));
  return score;
}

export function createDemoDataset(profile = {}) {
  const classNames = ['1班', '2班', '3班'];
  const teacherAssignments = [];
  const students = [];

  classNames.forEach((className, classIndex) => {
    SUBJECTS.forEach((subject) => {
      teacherAssignments.push({
        className,
        subject,
        teacherName: SUBJECT_TEACHERS[subject][classIndex]
      });
    });

    for (let studentIndex = 0; studentIndex < 24; studentIndex += 1) {
      const nameIndex = classIndex * 24 + studentIndex;
      const scores = {};
      SUBJECTS.forEach((subject, subjectIndex) => {
        const fullMark = SUBJECT_FULL_MARKS[subject];
        const bias = CLASS_BIASES[className] + SUBJECT_BIASES[className][subject] + subjectIndex * 1.6;
        scores[subject] = buildScore(nameIndex * 13 + subjectIndex * 7 + 11, fullMark, bias);
      });

      students.push({
        id: uid('stu'),
        name: createStudentName(nameIndex),
        studentId: `2026${String(classIndex + 1)}${String(studentIndex + 1).padStart(2, '0')}`,
        className,
        scores,
        total: Object.values(scores).reduce((sum, score) => sum + score, 0)
      });
    }
  });

  return {
    id: uid('exam'),
    schoolName: profile.name || '银山实验学校',
    gradeName: '九年级',
    termName: '2026 春季学期',
    examName: '四月质量检测',
    examDate: '2026-04-09',
    teacherAssignments,
    subjectFullMarks: SUBJECT_FULL_MARKS,
    students
  };
}
