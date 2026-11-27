/**
 * The operator check of an `operator` route, provided by the Ever Platform instance module when it is loaded (core code
 * does not import that module). Without it there is no operator route, and the access guard opens none.
 */
export const OPERATOR_CHECK = 'traduora:access:operator-check';

export interface OperatorCheck {
  isOperator(caller: unknown): boolean;
}
