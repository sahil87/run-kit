/** Frontend mirror of the backend's ValidBoardName regex. Centralized so the
 * route, sidebar input, and palette all agree on the validation contract. */
export const BOARD_NAME_REGEX = /^[A-Za-z0-9_-]{1,32}$/;

export function ValidBoardName(name: string): boolean {
  return BOARD_NAME_REGEX.test(name);
}
