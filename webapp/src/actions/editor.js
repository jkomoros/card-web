export const EDITING_START = 'EDITING_START';
export const EDITING_FINISH = 'EDITING_FINISH';

export const editingStart = () => {
  return {type: EDITING_START}
}

export const editingFinish = () => {
  return {type: EDITING_FINISH}
}
