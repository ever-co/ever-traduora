import { Closable } from 'types';
import * as process from 'process';

/**
 * Sets up a shutdown handler for graceful application termination.
 *
 * This function listens for the SIGINT signal (typically triggered by pressing Ctrl+C)
 * and ensures that all provided resources are closed gracefully before the application exits.
 *
 * @param closables - An array of objects implementing the Closable interface, each containing a `close` method that returns a Promise.
 *                    This method is expected to clean up or release resources associated with each object.
 */
export function setupShutdownHandler(closables: Closable[]) {
  process.on('SIGINT', async () => {
    console.log('Shutdown signal received. Initiating graceful shutdown...');
    console.log(`Total resources to close: ${closables.length}`);

    try {
      for (const [index, closable] of closables.entries()) {
        await closable.close();
        console.log(`Resource ${index + 1} closed successfully.`);
      }
    } catch (error) {
      console.error('Error occurred while closing resources:', error);
    } finally {
      process.exit(1);
    }
  });
}
