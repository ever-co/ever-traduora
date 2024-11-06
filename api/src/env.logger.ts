import { join } from 'path';
// see https://github.com/motdotla/dotenv#how-do-i-use-dotenv-with-import
import * as dotenv from 'dotenv';
dotenv.config({ path: join(__dirname, '../../.env') });

const env = process.env;

/**
 * Checks for the presence of critical environment variables and logs warnings if any are missing.
 * This function logs a warning if `TR_SECRET` is not set, indicating that a default value will be used.
 * This helps ensure that necessary environment variables are defined for security and configuration purposes.
 */
export function checkEnvVariables() {
    // Check TR_SECRET
    if (!env.TR_SECRET) {
        console.warn('TR_SECRET not set. Default value will be used. Please make sure you set it to your own value for security reasons in production!');
    }

    // Check Google Auth Configuration
    if (env.TR_AUTH_GOOGLE_ENABLED === 'true') {
        const missingVars = [];

        if (!env.TR_AUTH_GOOGLE_CLIENT_SECRET) {
            missingVars.push('TR_AUTH_GOOGLE_CLIENT_SECRET');
        }
        if (!env.TR_AUTH_GOOGLE_CLIENT_ID) {
            missingVars.push('TR_AUTH_GOOGLE_CLIENT_ID');
        }
        if (!env.TR_AUTH_GOOGLE_REDIRECT_URL) {
            missingVars.push('TR_AUTH_GOOGLE_REDIRECT_URL');
        }

        if (missingVars.length > 0) {
            console.warn(`You enabled Google Auth with TR_AUTH_GOOGLE_ENABLED = true, but did not set one or more required environment variables: ${missingVars.join(', ')}.`);
        }
    } else {
        console.info(`Google Auth is disabled. To enable, set TR_AUTH_GOOGLE_ENABLED = true and define the required environment variables: TR_AUTH_GOOGLE_CLIENT_SECRET, TR_AUTH_GOOGLE_CLIENT_ID, and TR_AUTH_GOOGLE_REDIRECT_URL.`)
    }
}

