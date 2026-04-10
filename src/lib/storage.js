import { DEFAULT_PROFILE, cloneValue } from './utils.js';

const STORAGE_KEY = 'school-internal-analysis-state-v1';

export function loadLocalState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return {
        profile: cloneValue(DEFAULT_PROFILE),
        datasets: [],
        activeDatasetId: ''
      };
    }
    const parsed = JSON.parse(raw);
    return {
      profile: {
        ...cloneValue(DEFAULT_PROFILE),
        ...(parsed?.profile || {})
      },
      datasets: Array.isArray(parsed?.datasets) ? parsed.datasets : [],
      activeDatasetId: parsed?.activeDatasetId || ''
    };
  } catch (error) {
    console.warn('读取本地状态失败，将重置为默认状态。', error);
    return {
      profile: cloneValue(DEFAULT_PROFILE),
      datasets: [],
      activeDatasetId: ''
    };
  }
}

export function saveLocalState(state) {
  const payload = {
    profile: state.profile,
    datasets: state.datasets,
    activeDatasetId: state.activeDatasetId
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
}
