import { ArgumentsHost, Catch, ExceptionFilter } from '@nestjs/common';

@Catch()
export class CustomExceptionFilter implements ExceptionFilter {
  catch(exception: any, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse();

    // Re-map forbidden to not found
    if (exception.name === 'EntityNotFound' || exception.status === 404 || exception.status === 403) {
      response.status(404).json({
        error: {
          code: 'NotFound',
          message: 'The requested resource could not be found',
        },
      });
    } else if (this.isInvalidUuidError(exception)) {
      // PostgreSQL UUID syntax errors should be treated as "not found"
      response.status(404).json({
        error: {
          code: 'NotFound',
          message: 'The requested resource could not be found',
        },
      });
    } else if (this.isUniqueConstraintViolation(exception)) {
      response.status(409).json({
        error: {
          code: 'AlreadyExists',
          message: 'This resource already exists',
        },
      });
    } else if (this.isSqliteError(exception)) {
      // SQLite generic errors - log for debugging and return internal error
      console.error('SQLite Error Details:', {
        name: exception.name,
        code: exception.code,
        message: exception.message,
        stack: exception.stack,
        sql: exception.sql,
        parameters: exception.parameters,
      });
      response.status(500).json({
        error: {
          code: 'Internal',
          message: 'An internal error occurred',
        },
      });
    } else if (exception.status === 401) {
      response.status(401).json({
        error: {
          code: 'Unauthorized',
          message: 'You are not authorized to access this resource',
        },
      });
    } else if (exception.status === 400 || exception.code === 'ER_DATA_TOO_LONG') {
      response.status(400).json({
        error: {
          code: 'BadRequest',
          message: 'Your request seems to be invalid or malformed',
        },
      });
    } else if (exception.status === 429) {
      response.status(429).json({
        error: {
          code: 'TooManyRequests',
          message: 'You are sending too many requests, please try again later',
        },
      });
    } else if (exception.status === 422) {
      response.status(422).json({
        error: {
          code: 'UnprocessableEntity',
          message: 'We understood the request, but are unable to process it',
        },
      });
    } else if (exception.status === 402) {
      response.status(402).json({
        error: {
          code: 'PaymentRequired',
          message: 'You seem to have reached your plan limit',
        },
      });
    } else if (exception.status === 413) {
      response.status(413).json({
        error: {
          code: 'PayloadTooLarge',
          message: 'Payload too large',
        },
      });
    } else {
      console.error(exception);
      response.status(500).json({
        error: {
          code: 'Internal',
          // tslint:disable-next-line:quotemark
          message: "Something wen't wrong, that's all we know",
        },
      });
    }
  }
  private isUniqueConstraintViolation(exception: any): boolean {
    return (
      exception.status === 409 ||
      (exception.name === 'QueryFailedError' && exception.code === 'ER_DUP_ENTRY') || // MySQL
      (exception.name === 'QueryFailedError' && exception.code === '23505') || // PostgreSQL unique constraint violation
      (exception.name === 'SqliteError' && exception.code === 'SQLITE_CONSTRAINT_UNIQUE') || // SQLite unique constraint
      (exception.name === 'QueryFailedError' && exception.code === 'SQLITE_CONSTRAINT_UNIQUE') || // SQLite via TypeORM
      (exception.errno === 19 && exception.code === 'SQLITE_CONSTRAINT') || // SQLite constraint error
      (exception.message && exception.message.includes('UNIQUE constraint failed')) // SQLite unique constraint message
    );
  }

  private isInvalidUuidError(exception: any): boolean {
    return (
      exception.name === 'QueryFailedError' &&
      exception.code === '22P02' && // PostgreSQL invalid input syntax error
      exception.message &&
      exception.message.includes('invalid input syntax for type uuid')
    );
  }

  private isSqliteError(exception: any): boolean {
    return exception.name === 'SqliteError' && exception.code === 'SQLITE_ERROR';
  }
}
