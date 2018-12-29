export const OPEN_COMMENTS_PANEL = 'OPEN_COMMENTS_PANEL';
export const CLOSE_COMMENTS_PANEL = 'CLOSE_COMMENTS_PANEL';

export const openCommentsPanel = () => {
  return {
    type: OPEN_COMMENTS_PANEL
  }
}

export const closeCommentsPanel = () => {
  return {
    type: CLOSE_COMMENTS_PANEL
  }
}