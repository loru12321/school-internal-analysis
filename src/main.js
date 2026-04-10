import './style.css';

import { Chart, registerables } from 'chart.js';

import * as CloudApi from './lib/cloud-api.js';
import { computeDatasetAnalysis, exportDatasetSnapshot, prepareDataset } from './lib/analysis-engine.js';
import { createDemoDataset } from './lib/demo-data.js';
import { parseScoreWorkbook, parseTeacherWorkbook } from './lib/importers.js';
import { loadLocalState, saveLocalState } from './lib/storage.js';
import {
  cloneValue,
  csvFromMatrix,
  downloadTextFile,
  escapeHtml,
  formatNumber,
  formatPercent
} from './lib/utils.js';

Chart.register(...registerables);

const app = document.querySelector('#app');
const toastLayer = document.createElement('div');
toastLayer.className = 'toast-layer';
document.body.appendChild(toastLayer);

const persisted = loadLocalState();
const state = {
  profile: persisted.profile,
  datasets: (persisted.datasets || []).map((dataset) => prepareDataset(dataset)),
  activeDatasetId: persisted.activeDatasetId,
  view: persisted.datasets?.length ? 'overview' : 'import',
  busyMessage: '',
  cloudAvailable: false,
  cloudMessage: '尚未检测 Cloudflare Worker 连接。',
  cloudCatalog: [],
  studentQuery: '',
  selectedStudentId: '',
  selectedClassName: '',
  selectedTeacherSubject: '',
  selectedTeacherKey: ''
};

const analysisCache = new Map();
const charts = {};

Chart.defaults.color = '#31433f';
Chart.defaults.borderColor = 'rgba(17, 53, 47, 0.12)';

if (!state.datasets.some((dataset) => dataset.id === state.activeDatasetId)) {
  state.activeDatasetId = state.datasets[0]?.id || '';
}

function persistState() {
  saveLocalState({
    profile: state.profile,
    datasets: state.datasets,
    activeDatasetId: state.activeDatasetId
  });
}

function getActiveDataset() {
  return state.datasets.find((dataset) => dataset.id === state.activeDatasetId) || null;
}

function getAnalysis(dataset) {
  if (!dataset) return null;
  const cacheKey = `${dataset.id}:${dataset.updatedAt}`;
  if (!analysisCache.has(cacheKey)) {
    analysisCache.set(cacheKey, computeDatasetAnalysis(dataset));
  }
  return analysisCache.get(cacheKey);
}

function updateDatasetList(nextDatasets, nextActiveId = state.activeDatasetId) {
  state.datasets = [...nextDatasets].sort((left, right) => String(right.updatedAt).localeCompare(String(left.updatedAt)));
  state.activeDatasetId = nextActiveId && state.datasets.some((dataset) => dataset.id === nextActiveId)
    ? nextActiveId
    : state.datasets[0]?.id || '';
  persistState();
}

function upsertDataset(rawDataset, { activate = true } = {}) {
  const prepared = prepareDataset({
    ...rawDataset,
    updatedAt: new Date().toISOString()
  });
  const nextDatasets = state.datasets.filter((dataset) => dataset.id !== prepared.id);
  nextDatasets.unshift(prepared);
  updateDatasetList(nextDatasets, activate ? prepared.id : state.activeDatasetId);
  analysisCache.clear();
}

function patchActiveDataset(patcher) {
  const current = getActiveDataset();
  if (!current) return;
  const draft = cloneValue(current);
  const result = patcher(draft) || draft;
  upsertDataset({
    ...current,
    ...result,
    id: current.id,
    createdAt: current.createdAt
  });
}

function removeDataset(datasetId) {
  updateDatasetList(state.datasets.filter((dataset) => dataset.id !== datasetId), state.activeDatasetId === datasetId ? '' : state.activeDatasetId);
  analysisCache.clear();
}

function setBusy(message = '') {
  state.busyMessage = message;
  render();
}

function clearBusy() {
  state.busyMessage = '';
  render();
}

function showToast(message, tone = 'info') {
  const toast = document.createElement('div');
  toast.className = `toast toast-${tone}`;
  toast.textContent = message;
  toastLayer.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add('is-visible'));
  setTimeout(() => {
    toast.classList.remove('is-visible');
    setTimeout(() => toast.remove(), 220);
  }, 2600);
}

function resetCharts() {
  Object.values(charts).forEach((chart) => {
    if (chart) chart.destroy();
  });
  Object.keys(charts).forEach((key) => delete charts[key]);
}

function formatDateText(value) {
  return value || '未填写';
}

function formatDateTimeText(value) {
  if (!value) return '未同步';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('zh-CN', { hour12: false });
}

function syncSelections(dataset, analysis) {
  if (!dataset || !analysis) {
    state.selectedStudentId = '';
    state.selectedClassName = '';
    state.selectedTeacherSubject = '';
    state.selectedTeacherKey = '';
    return;
  }

  if (!analysis.studentProfiles.some((student) => student.id === state.selectedStudentId)) {
    state.selectedStudentId = analysis.studentProfiles[0]?.id || '';
  }

  if (!analysis.classSummaries.some((summary) => summary.className === state.selectedClassName)) {
    state.selectedClassName = analysis.classSummaries[0]?.className || '';
  }

  if (!analysis.teacherSubjectOptions.includes(state.selectedTeacherSubject)) {
    state.selectedTeacherSubject = analysis.teacherSubjectOptions[0] || '';
  }

  const subjectRows = analysis.teacherBySubject[state.selectedTeacherSubject] || [];
  if (!subjectRows.some((row) => row.key === state.selectedTeacherKey)) {
    state.selectedTeacherKey = subjectRows[0]?.key || '';
  }
}

function renderNavButton(viewId, label) {
  const activeClass = state.view === viewId ? 'is-active' : '';
  return `<button class="nav-button ${activeClass}" data-action="switch-view" data-view="${viewId}">${label}</button>`;
}

function renderMetric(label, value, note = '') {
  return `
    <div class="metric-cell">
      <div class="metric-label">${escapeHtml(label)}</div>
      <div class="metric-value">${escapeHtml(value)}</div>
      <div class="metric-note">${escapeHtml(note)}</div>
    </div>
  `;
}

function renderEmptyState(title, body, actionLabel = '', action = '') {
  return `
    <div class="empty-state">
      <h3>${escapeHtml(title)}</h3>
      <p>${escapeHtml(body)}</p>
      ${action ? `<button class="btn-primary" data-action="${action}">${escapeHtml(actionLabel)}</button>` : ''}
    </div>
  `;
}

function renderDatasetRows() {
  if (!state.datasets.length) {
    return '<div class="inline-empty">本地还没有考试数据。</div>';
  }

  return `
    <div class="dataset-list">
      ${state.datasets.map((dataset) => `
        <article class="dataset-item ${dataset.id === state.activeDatasetId ? 'is-current' : ''}">
          <div>
            <div class="dataset-title">${escapeHtml(dataset.examName)}</div>
            <div class="dataset-meta">${escapeHtml(dataset.gradeName)} · ${escapeHtml(formatDateText(dataset.examDate))} · ${dataset.students.length} 人</div>
          </div>
          <div class="dataset-actions">
            <button class="btn-quiet" data-action="activate-dataset" data-dataset-id="${dataset.id}">切换</button>
            <button class="btn-quiet" data-action="export-dataset" data-dataset-id="${dataset.id}">导出</button>
            <button class="btn-quiet danger" data-action="remove-dataset" data-dataset-id="${dataset.id}">删除</button>
          </div>
        </article>
      `).join('')}
    </div>
  `;
}

function renderThresholdRows(dataset) {
  return dataset.subjects.map((subject) => `
    <tr>
      <td>${escapeHtml(subject)}</td>
      <td><input class="compact-input" name="fullMark::${subject}" type="number" step="1" value="${dataset.subjectFullMarks[subject]}" /></td>
      <td><input class="compact-input" name="exc::${subject}" type="number" step="0.1" value="${dataset.thresholds[subject].exc}" /></td>
      <td><input class="compact-input" name="pass::${subject}" type="number" step="0.1" value="${dataset.thresholds[subject].pass}" /></td>
      <td><input class="compact-input" name="low::${subject}" type="number" step="0.1" value="${dataset.thresholds[subject].low}" /></td>
    </tr>
  `).join('');
}

function renderTeacherAssignments(dataset) {
  if (!dataset.teacherAssignments.length) {
    return '<div class="inline-empty">当前考试还没有任课表，教师对比页会暂时为空。</div>';
  }

  return `
    <div class="table-wrap slim">
      <table class="data-table">
        <thead>
          <tr>
            <th>班级</th>
            <th>学科</th>
            <th>教师</th>
          </tr>
        </thead>
        <tbody>
          ${dataset.teacherAssignments.map((row) => `
            <tr>
              <td>${escapeHtml(row.className)}</td>
              <td>${escapeHtml(row.subject)}</td>
              <td>${escapeHtml(row.teacherName)}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
}

function renderImportPanel(dataset) {
  const classOptions = dataset?.students
    ? [...new Set(dataset.students.map((student) => student.className))].sort((left, right) => left.localeCompare(right, 'zh-Hans-CN'))
    : [];

  return `
    <div class="workspace-grid">
      <section class="stack">
        <div class="surface hero-surface">
          <div class="surface-kicker">导入与建档</div>
          <h2>只围绕一个学校，保留最需要的成绩分析链路</h2>
          <p>成绩文件负责学生分数与班级数据，任课文件负责教师同学科比较。旧式 <code>.xls</code> 请先另存为 <code>.xlsx</code> 再导入。</p>
          <form id="examImportForm" class="stack-form">
            <div class="form-grid">
              <label>
                <span>学校名称</span>
                <input name="schoolName" value="${escapeHtml(state.profile.name)}" required />
              </label>
              <label>
                <span>年级</span>
                <input name="gradeName" value="${escapeHtml(dataset?.gradeName || '九年级')}" required />
              </label>
              <label>
                <span>学期</span>
                <input name="termName" value="${escapeHtml(dataset?.termName || '2026 春季学期')}" />
              </label>
              <label>
                <span>考试名称</span>
                <input name="examName" value="${escapeHtml(dataset?.examName || '四月质量检测')}" required />
              </label>
              <label>
                <span>考试日期</span>
                <input name="examDate" type="date" value="${escapeHtml(dataset?.examDate || '')}" />
              </label>
            </div>
            <div class="upload-grid">
              <label class="file-field">
                <span>成绩文件</span>
                <input name="scoreFile" type="file" accept=".xlsx,.csv" required />
              </label>
              <label class="file-field">
                <span>任课文件（可选）</span>
                <input name="teacherFile" type="file" accept=".xlsx,.csv" />
              </label>
            </div>
            <div class="button-row">
              <button type="submit" class="btn-primary">导入本地考试</button>
              <button type="button" class="btn-secondary" data-action="load-demo">加载演示数据</button>
              <button type="button" class="btn-quiet" data-action="download-score-template">成绩模板</button>
              <button type="button" class="btn-quiet" data-action="download-teacher-template">任课模板</button>
            </div>
          </form>
        </div>

        ${dataset ? `
          <div class="surface">
            <div class="section-head">
              <div>
                <h3>当前考试口径</h3>
                <p>你可以直接调每科满分、优秀线、及格线和低分预警线。</p>
              </div>
            </div>
            <form id="thresholdForm">
              <div class="table-wrap">
                <table class="data-table">
                  <thead>
                    <tr>
                      <th>学科</th>
                      <th>满分</th>
                      <th>优秀线</th>
                      <th>及格线</th>
                      <th>低分线</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${renderThresholdRows(dataset)}
                    <tr>
                      <td>总分</td>
                      <td>${dataset.totalFullMark}</td>
                      <td><input class="compact-input" name="exc::total" type="number" step="0.1" value="${dataset.thresholds.total.exc}" /></td>
                      <td><input class="compact-input" name="pass::total" type="number" step="0.1" value="${dataset.thresholds.total.pass}" /></td>
                      <td><input class="compact-input" name="low::total" type="number" step="0.1" value="${dataset.thresholds.total.low}" /></td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <div class="button-row">
                <button type="submit" class="btn-primary">保存口径</button>
              </div>
            </form>
          </div>
        ` : ''}
      </section>

      <aside class="stack">
        ${dataset ? `
          <div class="surface">
            <div class="section-head">
              <div>
                <h3>任课表</h3>
                <p>当前考试的教师比较完全基于这里的班级-学科-教师映射。</p>
              </div>
            </div>
            <form id="teacherImportOnlyForm" class="inline-form">
              <label class="file-field compact">
                <span>追加任课文件</span>
                <input name="teacherOnlyFile" type="file" accept=".xlsx,.csv" required />
              </label>
              <button type="submit" class="btn-secondary">导入到当前考试</button>
            </form>
            <form id="manualTeacherForm" class="inline-form three-up">
              <label>
                <span>班级</span>
                <select name="className" required>
                  ${classOptions.map((className) => `<option value="${escapeHtml(className)}">${escapeHtml(className)}</option>`).join('')}
                </select>
              </label>
              <label>
                <span>学科</span>
                <select name="subject" required>
                  ${dataset.subjects.map((subject) => `<option value="${escapeHtml(subject)}">${escapeHtml(subject)}</option>`).join('')}
                </select>
              </label>
              <label>
                <span>教师姓名</span>
                <input name="teacherName" required />
              </label>
              <button type="submit" class="btn-quiet">手动补一条</button>
            </form>
            ${renderTeacherAssignments(dataset)}
          </div>
        ` : ''}

        <div class="surface">
          <div class="section-head">
            <div>
              <h3>本地考试库</h3>
              <p>所有数据默认先保存在本机浏览器里，不会碰原系统。</p>
            </div>
          </div>
          ${renderDatasetRows()}
        </div>
      </aside>
    </div>
  `;
}

function renderOverviewPanel(dataset, analysis) {
  if (!dataset || !analysis?.overview) {
    return renderEmptyState('还没有可分析的考试', '先在导入页导入成绩文件，系统才会生成班级、学生和教师分析。', '去导入', 'switch-import');
  }

  return `
    <div class="stack">
      <div class="surface masthead">
        <div class="surface-kicker">当前考试</div>
        <h2>${escapeHtml(dataset.examName)}</h2>
        <p>${escapeHtml(dataset.gradeName)} · ${escapeHtml(formatDateText(dataset.examDate))} · ${dataset.students.length} 名学生 · ${analysis.classSummaries.length} 个班级</p>
      </div>

      <div class="metric-strip">
        ${renderMetric('平均总分', formatNumber(analysis.overview.avgTotal), '按当前考试全体学生')}
        ${renderMetric('优秀率', formatPercent(analysis.overview.excellentRate), `总分 ≥ ${dataset.thresholds.total.exc}`)}
        ${renderMetric('及格率', formatPercent(analysis.overview.passRate), `总分 ≥ ${dataset.thresholds.total.pass}`)}
        ${renderMetric('低分预警', formatPercent(analysis.overview.lowRate), `总分 < ${dataset.thresholds.total.low}`)}
      </div>

      <div class="two-column">
        <div class="surface">
          <div class="section-head">
            <div>
              <h3>班级综合指数</h3>
              <p>${escapeHtml(analysis.overview.formulaText)}</p>
            </div>
          </div>
          <canvas id="overviewClassChart" height="280"></canvas>
        </div>
        <div class="surface">
          <div class="section-head">
            <div>
              <h3>学科均分与两率</h3>
              <p>柱形展示均分，折线同步展示优秀率与及格率。</p>
            </div>
          </div>
          <canvas id="overviewSubjectChart" height="280"></canvas>
        </div>
      </div>

      <div class="surface">
        <div class="section-head"><h3>班级总览</h3></div>
        <div class="table-wrap">
          <table class="data-table">
            <thead>
              <tr>
                <th>排名</th>
                <th>班级</th>
                <th>人数</th>
                <th>平均总分</th>
                <th>优秀率</th>
                <th>及格率</th>
                <th>综合指数</th>
                <th>班级尖子生</th>
              </tr>
            </thead>
            <tbody>
              ${analysis.classSummaries.map((summary) => `
                <tr>
                  <td>${summary.rank}</td>
                  <td>${escapeHtml(summary.className)}</td>
                  <td>${summary.studentCount}</td>
                  <td>${formatNumber(summary.avg)}</td>
                  <td>${formatPercent(summary.excellentRate)}</td>
                  <td>${formatPercent(summary.passRate)}</td>
                  <td>${formatNumber(summary.compositeIndex, 2)}</td>
                  <td>${escapeHtml(summary.topStudent)}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>

      <div class="surface">
        <div class="section-head"><h3>学科总览</h3></div>
        <div class="table-wrap">
          <table class="data-table">
            <thead>
              <tr>
                <th>学科</th>
                <th>满分</th>
                <th>平均分</th>
                <th>优秀率</th>
                <th>及格率</th>
                <th>低分率</th>
              </tr>
            </thead>
            <tbody>
              ${analysis.subjectSummaries.map((summary) => `
                <tr>
                  <td>${escapeHtml(summary.subject)}</td>
                  <td>${summary.fullMark}</td>
                  <td>${formatNumber(summary.avg)}</td>
                  <td>${formatPercent(summary.excellentRate)}</td>
                  <td>${formatPercent(summary.passRate)}</td>
                  <td>${formatPercent(summary.lowRate)}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `;
}

function renderStudentsPanel(dataset, analysis) {
  if (!dataset || !analysis?.studentProfiles?.length) {
    return renderEmptyState('学生分析还没准备好', '请先导入成绩后再查看学生画像。', '去导入', 'switch-import');
  }

  const query = state.studentQuery.trim();
  const filteredStudents = analysis.studentProfiles.filter((student) => {
    if (!query) return true;
    return [student.name, student.className, student.studentId].some((value) => String(value || '').includes(query));
  });

  const visibleStudent = filteredStudents.find((student) => student.id === state.selectedStudentId) || filteredStudents[0] || analysis.studentProfiles[0];
  const classSummary = analysis.classSummaryMap.get(visibleStudent.className);

  return `
    <div class="two-column detail-layout">
      <div class="surface">
        <div class="section-head">
          <div>
            <h3>学生检索</h3>
            <p>支持按姓名、班级、学号筛选。</p>
          </div>
          <div class="toolbar">
            <input id="studentSearchInput" class="search-input" value="${escapeHtml(state.studentQuery)}" placeholder="搜索姓名 / 班级 / 学号" />
            <span class="toolbar-meta">${filteredStudents.length} / ${analysis.studentProfiles.length}</span>
          </div>
        </div>
        <div class="table-wrap large">
          <table class="data-table">
            <thead>
              <tr>
                <th>年级排名</th>
                <th>姓名</th>
                <th>班级</th>
                <th>总分</th>
                <th>状态</th>
                <th>优势学科</th>
              </tr>
            </thead>
            <tbody>
              ${filteredStudents.map((student) => `
                <tr class="${student.id === visibleStudent.id ? 'is-selected-row' : ''}" data-action="select-student" data-student-id="${student.id}">
                  <td>${student.rank}</td>
                  <td>${escapeHtml(student.name)}</td>
                  <td>${escapeHtml(student.className)}</td>
                  <td>${formatNumber(student.total)}</td>
                  <td><span class="status-pill status-${student.status}">${escapeHtml(student.status)}</span></td>
                  <td>${escapeHtml(student.strongestSubjects[0]?.subject || '-')}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>

      <div class="surface inspector">
        <div class="section-head">
          <div>
            <h3>${escapeHtml(visibleStudent.name)}</h3>
            <p>${escapeHtml(visibleStudent.className)} · 班级第 ${visibleStudent.classRank || '-'} · 年级第 ${visibleStudent.rank || '-'}</p>
          </div>
        </div>
        <div class="metric-strip compact">
          ${renderMetric('总分', formatNumber(visibleStudent.total), visibleStudent.status)}
          ${renderMetric('距优秀线', visibleStudent.totalGapToExc <= 0 ? '已达到' : `${formatNumber(visibleStudent.totalGapToExc)} 分`, `优秀线 ${dataset.thresholds.total.exc}`)}
          ${renderMetric('距及格线', visibleStudent.totalGapToPass <= 0 ? '已达到' : `${formatNumber(visibleStudent.totalGapToPass)} 分`, `及格线 ${dataset.thresholds.total.pass}`)}
        </div>
        <div class="tag-strip">
          <span class="tag positive">优势：${escapeHtml(visibleStudent.strongestSubjects.map((item) => item.subject).join('、') || '暂无')}</span>
          <span class="tag warn">关注：${escapeHtml(visibleStudent.weakestSubjects.map((item) => item.subject).join('、') || '暂无')}</span>
          <span class="tag neutral">临界：${escapeHtml(visibleStudent.borderline.join('；') || '暂无')}</span>
        </div>
        <div class="table-wrap slim">
          <table class="data-table">
            <thead>
              <tr>
                <th>学科</th>
                <th>分数</th>
                <th>级均</th>
                <th>班均</th>
                <th>级排</th>
                <th>班排</th>
              </tr>
            </thead>
            <tbody>
              ${dataset.subjects.map((subject) => {
                const gradeSummary = analysis.gradeSubjectMap.get(subject);
                const classMetric = classSummary?.subjectMetricsMap.get(subject);
                return `
                  <tr>
                    <td>${escapeHtml(subject)}</td>
                    <td>${formatNumber(visibleStudent.scores[subject] || 0)}</td>
                    <td>${formatNumber(gradeSummary?.avg || 0)}</td>
                    <td>${formatNumber(classMetric?.avg || 0)}</td>
                    <td>${visibleStudent.subjectRanks[subject] || '-'}</td>
                    <td>${visibleStudent.classSubjectRanks[subject] || '-'}</td>
                  </tr>
                `;
              }).join('')}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `;
}

function renderClassesPanel(dataset, analysis) {
  if (!dataset || !analysis?.classSummaries?.length) {
    return renderEmptyState('班级比较还没准备好', '请先导入成绩后再查看班级对比。', '去导入', 'switch-import');
  }

  const className = state.selectedClassName || analysis.classSummaries[0]?.className;
  const selectedClass = analysis.classSummaryMap.get(className) || analysis.classSummaryMap.get(analysis.classSummaries[0]?.className);

  return `
    <div class="stack">
      <div class="surface">
        <div class="section-head">
          <div>
            <h3>班级焦点</h3>
            <p>对比当前班与年级平均的分布差异。</p>
          </div>
          <select id="classFocusSelect" class="select-input">
            ${analysis.classSummaries.map((summary) => `<option value="${escapeHtml(summary.className)}" ${summary.className === selectedClass.className ? 'selected' : ''}>${escapeHtml(summary.className)}</option>`).join('')}
          </select>
        </div>
        <div class="metric-strip compact">
          ${renderMetric('班级人数', selectedClass.studentCount, '当前实考人数')}
          ${renderMetric('平均总分', formatNumber(selectedClass.avg), `综合指数 ${formatNumber(selectedClass.compositeIndex, 2)}`)}
          ${renderMetric('优秀率', formatPercent(selectedClass.excellentRate), `班级排名 ${selectedClass.rank}`)}
          ${renderMetric('及格率', formatPercent(selectedClass.passRate), `尖子生 ${selectedClass.topStudent}`)}
        </div>
      </div>

      <div class="two-column">
        <div class="surface">
          <div class="section-head"><h3>${escapeHtml(selectedClass.className)} 学科轮廓</h3></div>
          <canvas id="classRadarChart" height="300"></canvas>
        </div>
        <div class="surface">
          <div class="section-head"><h3>${escapeHtml(selectedClass.className)} 分学科对照</h3></div>
          <div class="table-wrap slim">
            <table class="data-table">
              <thead>
                <tr>
                  <th>学科</th>
                  <th>班均</th>
                  <th>级均</th>
                  <th>差值</th>
                  <th>优秀率</th>
                  <th>及格率</th>
                </tr>
              </thead>
              <tbody>
                ${selectedClass.subjectMetrics.map((metric) => `
                  <tr>
                    <td>${escapeHtml(metric.subject)}</td>
                    <td>${formatNumber(metric.avg)}</td>
                    <td>${formatNumber(analysis.gradeSubjectMap.get(metric.subject)?.avg || 0)}</td>
                    <td class="${metric.avgDelta >= 0 ? 'positive-text' : 'negative-text'}">${metric.avgDelta >= 0 ? '+' : ''}${formatNumber(metric.avgDelta)}</td>
                    <td>${formatPercent(metric.excellentRate)}</td>
                    <td>${formatPercent(metric.passRate)}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div class="surface">
        <div class="section-head"><h3>全班级比较</h3></div>
        <div class="table-wrap">
          <table class="data-table">
            <thead>
              <tr>
                <th>排名</th>
                <th>班级</th>
                <th>人数</th>
                <th>平均总分</th>
                <th>优秀率</th>
                <th>及格率</th>
                <th>低分率</th>
                <th>综合指数</th>
              </tr>
            </thead>
            <tbody>
              ${analysis.classSummaries.map((summary) => `
                <tr class="${summary.className === selectedClass.className ? 'is-selected-row' : ''}">
                  <td>${summary.rank}</td>
                  <td>${escapeHtml(summary.className)}</td>
                  <td>${summary.studentCount}</td>
                  <td>${formatNumber(summary.avg)}</td>
                  <td>${formatPercent(summary.excellentRate)}</td>
                  <td>${formatPercent(summary.passRate)}</td>
                  <td>${formatPercent(summary.lowRate)}</td>
                  <td>${formatNumber(summary.compositeIndex, 2)}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `;
}

function renderTeachersPanel(dataset, analysis) {
  if (!dataset || !analysis?.teacherSubjectOptions?.length) {
    return renderEmptyState('教师同学科比较暂时为空', '请先导入任课表，再让系统按“班级 + 学科 + 教师”汇总数据。', '去导入任课表', 'switch-import');
  }

  const subject = state.selectedTeacherSubject || analysis.teacherSubjectOptions[0];
  const teacherRows = analysis.teacherBySubject[subject] || [];
  const selectedTeacher = teacherRows.find((row) => row.key === state.selectedTeacherKey) || teacherRows[0];

  return `
    <div class="stack">
      <div class="surface">
        <div class="section-head">
          <div>
            <h3>同学科教师比较</h3>
            <p>每个学科内按平均分、优秀率、及格率生成单校综合指数。</p>
          </div>
          <select id="teacherSubjectSelect" class="select-input">
            ${analysis.teacherSubjectOptions.map((subjectName) => `<option value="${escapeHtml(subjectName)}" ${subjectName === subject ? 'selected' : ''}>${escapeHtml(subjectName)}</option>`).join('')}
          </select>
        </div>
        <canvas id="teacherSubjectChart" height="280"></canvas>
      </div>

      <div class="two-column">
        <div class="surface">
          <div class="section-head"><h3>${escapeHtml(subject)} 教师排行</h3></div>
          <div class="table-wrap">
            <table class="data-table">
              <thead>
                <tr>
                  <th>排名</th>
                  <th>教师</th>
                  <th>任课班级</th>
                  <th>学生数</th>
                  <th>平均分</th>
                  <th>优秀率</th>
                  <th>及格率</th>
                  <th>综合指数</th>
                </tr>
              </thead>
              <tbody>
                ${teacherRows.map((row) => `
                  <tr class="${row.key === selectedTeacher.key ? 'is-selected-row' : ''}" data-action="select-teacher" data-teacher-key="${row.key}">
                    <td>${row.rank}</td>
                    <td>${escapeHtml(row.teacherName)}</td>
                    <td>${escapeHtml(row.classesText)}</td>
                    <td>${row.studentCount}</td>
                    <td>${formatNumber(row.avg)}</td>
                    <td>${formatPercent(row.excellentRate)}</td>
                    <td>${formatPercent(row.passRate)}</td>
                    <td>${formatNumber(row.compositeIndex, 2)}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>

        <div class="surface inspector">
          <div class="section-head">
            <div>
              <h3>${escapeHtml(selectedTeacher.teacherName)}</h3>
              <p>${escapeHtml(subject)} · ${escapeHtml(selectedTeacher.classesText)}</p>
            </div>
          </div>
          <div class="metric-strip compact">
            ${renderMetric('综合指数', formatNumber(selectedTeacher.compositeIndex, 2), `学科内第 ${selectedTeacher.rank}`)}
            ${renderMetric('平均分', formatNumber(selectedTeacher.avg), `${selectedTeacher.studentCount} 名学生`)}
            ${renderMetric('优秀率', formatPercent(selectedTeacher.excellentRate), `${selectedTeacher.classCount} 个班级`)}
            ${renderMetric('及格率', formatPercent(selectedTeacher.passRate), formatPercent(selectedTeacher.lowRate) + ' 低分率')}
          </div>
          <div class="table-wrap slim">
            <table class="data-table">
              <thead>
                <tr>
                  <th>班级</th>
                  <th>人数</th>
                  <th>平均分</th>
                  <th>优秀率</th>
                  <th>及格率</th>
                </tr>
              </thead>
              <tbody>
                ${selectedTeacher.classBreakdown.map((item) => `
                  <tr>
                    <td>${escapeHtml(item.className)}</td>
                    <td>${item.studentCount}</td>
                    <td>${formatNumber(item.avg)}</td>
                    <td>${formatPercent(item.excellentRate)}</td>
                    <td>${formatPercent(item.passRate)}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  `;
}

function renderCloudPanel(dataset) {
  return `
    <div class="stack">
      <div class="surface">
        <div class="section-head">
          <div>
            <h3>Cloudflare 同步</h3>
            <p>前端页面与 D1 数据库存放在独立的新系统里，不触碰原系统仓库。</p>
          </div>
        </div>
        <div class="metric-strip compact">
          ${renderMetric('连接状态', state.cloudAvailable ? '已连通' : '未检测', state.cloudAvailable ? 'Worker API 正常' : '先点一次检测连接')}
          ${renderMetric('本地考试数', String(state.datasets.length), '浏览器已保存')}
          ${renderMetric('当前考试', dataset ? dataset.examName : '暂无', dataset ? dataset.gradeName : '等待导入')}
          ${renderMetric('最近提示', state.cloudMessage, '')}
        </div>
        <div class="button-row">
          <button class="btn-primary" data-action="ping-cloud">检测连接</button>
          <button class="btn-secondary" data-action="sync-profile-cloud">同步学校信息</button>
          <button class="btn-secondary" data-action="sync-dataset-cloud" ${dataset ? '' : 'disabled'}>上传当前考试</button>
          <button class="btn-quiet" data-action="refresh-cloud-catalog">读取云端目录</button>
        </div>
      </div>

      <div class="surface">
        <div class="section-head"><h3>云端考试库</h3></div>
        ${state.cloudCatalog.length ? `
          <div class="table-wrap">
            <table class="data-table">
              <thead>
                <tr>
                  <th>考试</th>
                  <th>年级</th>
                  <th>日期</th>
                  <th>人数</th>
                  <th>更新时间</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                ${state.cloudCatalog.map((row) => `
                  <tr>
                    <td>${escapeHtml(row.examName)}</td>
                    <td>${escapeHtml(row.gradeName)}</td>
                    <td>${escapeHtml(formatDateText(row.examDate))}</td>
                    <td>${row.studentCount}</td>
                    <td>${escapeHtml(formatDateTimeText(row.updatedAt))}</td>
                    <td class="action-cell">
                      <button class="btn-quiet" data-action="import-cloud-dataset" data-dataset-id="${row.id}">载入到本地</button>
                      <button class="btn-quiet danger" data-action="delete-cloud-dataset" data-dataset-id="${row.id}">删除云端</button>
                    </td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        ` : '<div class="inline-empty">还没有读取到云端目录，先点击“读取云端目录”。</div>'}
      </div>
    </div>
  `;
}

function renderActivePanel(dataset, analysis) {
  switch (state.view) {
    case 'overview':
      return renderOverviewPanel(dataset, analysis);
    case 'students':
      return renderStudentsPanel(dataset, analysis);
    case 'classes':
      return renderClassesPanel(dataset, analysis);
    case 'teachers':
      return renderTeachersPanel(dataset, analysis);
    case 'cloud':
      return renderCloudPanel(dataset);
    case 'import':
    default:
      return renderImportPanel(dataset);
  }
}
function drawCharts(dataset, analysis) {
  if (!dataset || !analysis) return;

  if (state.view === 'overview') {
    const classCanvas = document.getElementById('overviewClassChart');
    if (classCanvas) {
      charts.overviewClassChart = new Chart(classCanvas, {
        type: 'bar',
        data: {
          labels: analysis.classSummaries.map((summary) => summary.className),
          datasets: [{
            label: '综合指数',
            data: analysis.classSummaries.map((summary) => summary.compositeIndex),
            backgroundColor: ['#0f766e', '#1d8f82', '#7cb342', '#d97706']
          }]
        },
        options: {
          responsive: true,
          plugins: { legend: { display: false } },
          scales: {
            y: { beginAtZero: true, suggestedMax: 100 }
          }
        }
      });
    }

    const subjectCanvas = document.getElementById('overviewSubjectChart');
    if (subjectCanvas) {
      charts.overviewSubjectChart = new Chart(subjectCanvas, {
        data: {
          labels: analysis.subjectSummaries.map((summary) => summary.subject),
          datasets: [
            {
              type: 'bar',
              label: '平均分',
              data: analysis.subjectSummaries.map((summary) => summary.avg),
              backgroundColor: '#11352f'
            },
            {
              type: 'line',
              label: '优秀率',
              data: analysis.subjectSummaries.map((summary) => summary.excellentRate * 100),
              borderColor: '#b45309',
              backgroundColor: '#b45309',
              yAxisID: 'rate'
            },
            {
              type: 'line',
              label: '及格率',
              data: analysis.subjectSummaries.map((summary) => summary.passRate * 100),
              borderColor: '#1d8f82',
              backgroundColor: '#1d8f82',
              yAxisID: 'rate'
            }
          ]
        },
        options: {
          responsive: true,
          scales: {
            y: { beginAtZero: true },
            rate: {
              beginAtZero: true,
              position: 'right',
              suggestedMax: 100,
              grid: { drawOnChartArea: false }
            }
          }
        }
      });
    }
  }

  if (state.view === 'classes') {
    const classCanvas = document.getElementById('classRadarChart');
    const selectedClass = analysis.classSummaryMap.get(state.selectedClassName);
    if (classCanvas && selectedClass) {
      charts.classRadarChart = new Chart(classCanvas, {
        type: 'radar',
        data: {
          labels: dataset.subjects,
          datasets: [
            {
              label: selectedClass.className,
              data: selectedClass.subjectMetrics.map((metric) => metric.avg),
              borderColor: '#0f766e',
              backgroundColor: 'rgba(15, 118, 110, 0.18)'
            },
            {
              label: '年级平均',
              data: dataset.subjects.map((subject) => analysis.gradeSubjectMap.get(subject)?.avg || 0),
              borderColor: '#b45309',
              backgroundColor: 'rgba(180, 83, 9, 0.12)'
            }
          ]
        },
        options: {
          responsive: true,
          scales: {
            r: {
              beginAtZero: true
            }
          }
        }
      });
    }
  }

  if (state.view === 'teachers') {
    const teacherCanvas = document.getElementById('teacherSubjectChart');
    const teacherRows = analysis.teacherBySubject[state.selectedTeacherSubject] || [];
    if (teacherCanvas && teacherRows.length) {
      charts.teacherSubjectChart = new Chart(teacherCanvas, {
        type: 'bar',
        data: {
          labels: teacherRows.map((row) => row.teacherName),
          datasets: [{
            label: '综合指数',
            data: teacherRows.map((row) => row.compositeIndex),
            backgroundColor: '#11352f'
          }]
        },
        options: {
          indexAxis: 'y',
          responsive: true,
          plugins: { legend: { display: false } },
          scales: {
            x: { beginAtZero: true, suggestedMax: 100 }
          }
        }
      });
    }
  }
}

function render() {
  const dataset = getActiveDataset();
  const analysis = getAnalysis(dataset);
  syncSelections(dataset, analysis);
  resetCharts();

  app.innerHTML = `
    <div class="shell">
      <aside class="rail">
        <div class="brand-block">
          <div class="brand-eyebrow">Single-school score analytics</div>
          <h1>校内分析</h1>
          <p>从原系统借鉴口径，但新系统只服务一个学校，不再带乡镇横向和考务工具。</p>
        </div>

        <div class="rail-current">
          <div class="rail-label">当前学校</div>
          <div class="rail-school">${escapeHtml(state.profile.name)}</div>
          <div class="rail-meta">${dataset ? `${escapeHtml(dataset.examName)} · ${escapeHtml(dataset.gradeName)}` : '等待导入考试'}</div>
        </div>

        <nav class="nav-list">
          ${renderNavButton('import', '导入与建档')}
          ${renderNavButton('overview', '总览')}
          ${renderNavButton('students', '学生分析')}
          ${renderNavButton('classes', '班级比较')}
          ${renderNavButton('teachers', '教师比较')}
          ${renderNavButton('cloud', '云端同步')}
        </nav>

        <div class="rail-status">
          <div class="rail-label">Cloudflare</div>
          <div class="rail-status-text">${escapeHtml(state.cloudAvailable ? '可用' : '未检测')}</div>
          <div class="rail-status-note">${escapeHtml(state.cloudMessage)}</div>
        </div>
      </aside>

      <main class="workspace">
        <header class="workspace-head">
          <div>
            <div class="workspace-kicker">${escapeHtml(state.view === 'import' ? '准备数据' : '分析工作台')}</div>
            <h2>${escapeHtml({
              import: '导入与建档',
              overview: '总览',
              students: '学生分析',
              classes: '班级比较',
              teachers: '教师比较',
              cloud: '云端同步'
            }[state.view])}</h2>
          </div>
          <div class="workspace-meta">
            <span>${dataset ? `${escapeHtml(dataset.students.length)} 名学生` : '暂无考试'}</span>
            <span>${dataset ? `${escapeHtml(dataset.subjects.join(' / '))}` : '导入后自动识别学科'}</span>
          </div>
        </header>

        <section class="workspace-body">
          ${renderActivePanel(dataset, analysis)}
        </section>
      </main>
    </div>

    ${state.busyMessage ? `
      <div class="busy-overlay">
        <div class="busy-card">
          <div class="busy-spinner"></div>
          <div>${escapeHtml(state.busyMessage)}</div>
        </div>
      </div>
    ` : ''}
  `;

  drawCharts(dataset, analysis);
}

function downloadScoreTemplate() {
  const matrix = [
    ['姓名', '班级', '学号', '语文', '数学', '英语', '物理', '化学', '总分'],
    ['张三', '1班', '20260101', 98, 102, 94, 68, 61, 423]
  ];
  downloadTextFile('成绩导入模板.csv', csvFromMatrix(matrix), 'text/csv;charset=utf-8');
}

function downloadTeacherTemplate() {
  const matrix = [
    ['班级', '学科', '教师'],
    ['1班', '语文', '李老师'],
    ['1班', '数学', '王老师']
  ];
  downloadTextFile('任课表导入模板.csv', csvFromMatrix(matrix), 'text/csv;charset=utf-8');
}

async function refreshCloudCatalog() {
  const payload = await CloudApi.listCloudDatasets();
  state.cloudCatalog = payload.items || [];
  state.cloudAvailable = true;
  state.cloudMessage = `读取到 ${state.cloudCatalog.length} 条云端记录。`;
}

app.addEventListener('click', async (event) => {
  const trigger = event.target.closest('[data-action]');
  if (!trigger) return;

  const action = trigger.dataset.action;
  const datasetId = trigger.dataset.datasetId;
  const studentId = trigger.dataset.studentId;
  const teacherKey = trigger.dataset.teacherKey;

  try {
    switch (action) {
      case 'switch-view':
        state.view = trigger.dataset.view;
        render();
        return;
      case 'switch-import':
        state.view = 'import';
        render();
        return;
      case 'activate-dataset':
        state.activeDatasetId = datasetId;
        persistState();
        render();
        return;
      case 'remove-dataset':
        removeDataset(datasetId);
        showToast('已从本地删除该考试。', 'info');
        render();
        return;
      case 'export-dataset': {
        const dataset = state.datasets.find((item) => item.id === datasetId);
        if (!dataset) return;
        downloadTextFile(`${dataset.examName}.json`, JSON.stringify(exportDatasetSnapshot(dataset), null, 2), 'application/json;charset=utf-8');
        return;
      }
      case 'load-demo':
        upsertDataset(createDemoDataset(state.profile));
        state.view = 'overview';
        showToast('演示数据已载入，你可以直接查看分析页。', 'success');
        render();
        return;
      case 'download-score-template':
        downloadScoreTemplate();
        return;
      case 'download-teacher-template':
        downloadTeacherTemplate();
        return;
      case 'select-student':
        state.selectedStudentId = studentId;
        render();
        return;
      case 'select-teacher':
        state.selectedTeacherKey = teacherKey;
        render();
        return;
      case 'ping-cloud': {
        setBusy('正在检测 Cloudflare Worker...');
        const health = await CloudApi.pingCloud();
        state.cloudAvailable = true;
        state.cloudMessage = health.message || 'Cloudflare Worker 可用。';
        clearBusy();
        showToast('Cloudflare Worker 已连通。', 'success');
        return;
      }
      case 'sync-profile-cloud':
        setBusy('正在同步学校信息...');
        await CloudApi.saveCloudProfile(state.profile);
        state.cloudAvailable = true;
        state.cloudMessage = '学校信息已同步到 Cloudflare。';
        clearBusy();
        showToast('学校信息已同步。', 'success');
        return;
      case 'sync-dataset-cloud': {
        const dataset = getActiveDataset();
        if (!dataset) return;
        setBusy('正在上传当前考试到 Cloudflare...');
        await CloudApi.saveCloudDataset(dataset);
        state.cloudAvailable = true;
        state.cloudMessage = `${dataset.examName} 已同步到 Cloudflare。`;
        await refreshCloudCatalog();
        clearBusy();
        showToast('当前考试已上传到云端。', 'success');
        return;
      }
      case 'refresh-cloud-catalog':
        setBusy('正在读取云端考试目录...');
        await refreshCloudCatalog();
        clearBusy();
        showToast('云端目录已刷新。', 'success');
        return;
      case 'import-cloud-dataset': {
        setBusy('正在读取云端考试...');
        const payload = await CloudApi.fetchCloudDataset(datasetId);
        upsertDataset(payload.item);
        state.view = 'overview';
        clearBusy();
        showToast('云端考试已载入到本地。', 'success');
        render();
        return;
      }
      case 'delete-cloud-dataset':
        setBusy('正在删除云端考试...');
        await CloudApi.deleteCloudDataset(datasetId);
        await refreshCloudCatalog();
        clearBusy();
        showToast('云端考试已删除。', 'info');
        render();
        return;
      default:
        return;
    }
  } catch (error) {
    clearBusy();
    showToast(error.message || '操作失败', 'error');
  }
});

app.addEventListener('change', (event) => {
  if (event.target.id === 'classFocusSelect') {
    state.selectedClassName = event.target.value;
    render();
  }
  if (event.target.id === 'teacherSubjectSelect') {
    state.selectedTeacherSubject = event.target.value;
    render();
  }
});

app.addEventListener('input', (event) => {
  if (event.target.id === 'studentSearchInput') {
    state.studentQuery = event.target.value;
    render();
  }
});

app.addEventListener('submit', async (event) => {
  event.preventDefault();

  try {
    if (event.target.id === 'examImportForm') {
      const formData = new FormData(event.target);
      const scoreFile = formData.get('scoreFile');
      const teacherFile = formData.get('teacherFile');
      if (!(scoreFile instanceof File) || !scoreFile.name) {
        showToast('请先选择成绩文件。', 'error');
        return;
      }

      setBusy('正在解析成绩文件...');
      const importedScores = await parseScoreWorkbook(scoreFile);
      let teacherAssignments = [];
      if (teacherFile instanceof File && teacherFile.name) {
        setBusy('正在解析任课文件...');
        teacherAssignments = await parseTeacherWorkbook(teacherFile);
      }

      state.profile.name = String(formData.get('schoolName') || state.profile.name).trim() || state.profile.name;

      upsertDataset({
        schoolName: state.profile.name,
        gradeName: String(formData.get('gradeName') || '').trim(),
        termName: String(formData.get('termName') || '').trim(),
        examName: String(formData.get('examName') || '').trim(),
        examDate: String(formData.get('examDate') || '').trim(),
        teacherAssignments,
        students: importedScores.students
      });

      state.view = 'overview';
      clearBusy();
      showToast('本地考试导入完成。', 'success');
      render();
      return;
    }

    if (event.target.id === 'thresholdForm') {
      const dataset = getActiveDataset();
      if (!dataset) return;
      const formData = new FormData(event.target);
      patchActiveDataset((draft) => {
        draft.subjects.forEach((subject) => {
          draft.subjectFullMarks[subject] = Number(formData.get(`fullMark::${subject}`) || draft.subjectFullMarks[subject]);
          draft.thresholds[subject].exc = Number(formData.get(`exc::${subject}`) || draft.thresholds[subject].exc);
          draft.thresholds[subject].pass = Number(formData.get(`pass::${subject}`) || draft.thresholds[subject].pass);
          draft.thresholds[subject].low = Number(formData.get(`low::${subject}`) || draft.thresholds[subject].low);
        });
        draft.thresholds.total.exc = Number(formData.get('exc::total') || draft.thresholds.total.exc);
        draft.thresholds.total.pass = Number(formData.get('pass::total') || draft.thresholds.total.pass);
        draft.thresholds.total.low = Number(formData.get('low::total') || draft.thresholds.total.low);
      });
      showToast('当前考试口径已更新。', 'success');
      render();
      return;
    }

    if (event.target.id === 'teacherImportOnlyForm') {
      const formData = new FormData(event.target);
      const teacherFile = formData.get('teacherOnlyFile');
      if (!(teacherFile instanceof File) || !teacherFile.name) {
        showToast('请先选择任课文件。', 'error');
        return;
      }

      setBusy('正在导入任课文件...');
      const teacherAssignments = await parseTeacherWorkbook(teacherFile);
      patchActiveDataset((draft) => {
        draft.teacherAssignments = teacherAssignments;
      });
      clearBusy();
      showToast('任课表已导入到当前考试。', 'success');
      render();
      return;
    }

    if (event.target.id === 'manualTeacherForm') {
      const formData = new FormData(event.target);
      patchActiveDataset((draft) => {
        draft.teacherAssignments = [
          ...draft.teacherAssignments.filter((row) => !(row.className === formData.get('className') && row.subject === formData.get('subject'))),
          {
            className: String(formData.get('className') || '').trim(),
            subject: String(formData.get('subject') || '').trim(),
            teacherName: String(formData.get('teacherName') || '').trim()
          }
        ];
      });
      showToast('任课记录已补充。', 'success');
      render();
    }
  } catch (error) {
    clearBusy();
    showToast(error.message || '提交失败', 'error');
  }
});

render();
