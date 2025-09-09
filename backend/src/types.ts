/**
 * Defines a contract for objects that can be closed gracefully.
 *
 * Any class implementing this interface should provide a `close` method
 * that performs cleanup or resource release and returns a Promise that
 * resolves when the operation is complete.
 */
export interface Closable {
  close(): Promise<void>;
}
