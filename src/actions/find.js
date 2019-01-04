export const FIND_DIALOG_OPEN = 'FIND_DIALOG_OPEN';
export const FIND_DIALOG_CLOSE ='FIND_DIALOG_CLOSE';


export const openFindDialog = () => {
  return {
    type: FIND_DIALOG_OPEN
  }
}

export const closeFindDialog = () => {
  return {
    type: FIND_DIALOG_CLOSE
  }
}