export const PROMPT_COMPOSE_SHOW = 'PROMPT_COMPOSE_SHOW';
export const PROMPT_COMPOSE_CANCEL = 'PROMPT_COMPOSE_CANCEL';
export const PROMPT_COMPOSE_COMMIT = 'PROMPT_COMPOSE_COMMIT';

export const composeShow = () => {
  return {
    type: PROMPT_COMPOSE_SHOW
  }
}

export const composeCancel = () => {
  return {
    type: PROMPT_COMPOSE_CANCEL
  }
}

export const composeCommit = () => {
  return {
    type: PROMPT_COMPOSE_COMMIT
  }
}