import { BadRequestException } from '@nestjs/common';
import { FormatCannotHoldTermsException } from '../errors';
import { CustomExceptionFilter } from './exception.filter';

describe('CustomExceptionFilter', () => {
  function respond(exception: any) {
    const response: any = { headers: {} };
    response.setHeader = jest.fn((name: string, value: string) => (response.headers[name] = value));
    response.status = jest.fn((status: number) => {
      response.statusCode = status;
      return response;
    });
    response.json = jest.fn((body: any) => (response.body = body));
    const host: any = { switchToHttp: () => ({ getResponse: () => response }) };
    new CustomExceptionFilter().catch(exception, host);
    return response;
  }

  it('answers a deadlock or lock timeout with 503 and a retry delay', () => {
    for (const code of ['ER_LOCK_DEADLOCK', 'ER_LOCK_WAIT_TIMEOUT', '40P01']) {
      const response = respond({ name: 'QueryFailedError', code, message: 'Deadlock found when trying to get lock' });

      expect(response.statusCode).toBe(503);
      expect(response.headers['Retry-After']).toBe('1');
      expect(response.body.error.code).toBe('Busy');
    }
  });

  it('still answers a duplicate with 409', () => {
    expect(respond({ name: 'QueryFailedError', code: 'ER_DUP_ENTRY', message: 'Duplicate entry' }).statusCode).toBe(409);
  });

  it('answers an export the format cannot hold with 400 and the message that names the terms', () => {
    const message = 'jsonnested cannot hold the term "app" together with "app.title": a key cannot have both a value and sub keys.';

    const response = respond(new FormatCannotHoldTermsException(message));

    expect(response.statusCode).toBe(400);
    expect(response.body).toEqual({ error: { code: 'BadRequest', message } });
  });

  it('keeps the message of an export the format cannot hold when it quotes a database error', () => {
    // The message quotes term names, which may read like the database errors the filter otherwise recognizes by text
    const message = 'jsonnested cannot hold the term "UNIQUE constraint failed" together with "UNIQUE constraint failed.x"';

    const response = respond(new FormatCannotHoldTermsException(message));

    expect(response.statusCode).toBe(400);
    expect(response.body).toEqual({ error: { code: 'BadRequest', message } });
  });

  it('answers any other 400 with the fixed message', () => {
    const response = respond(new BadRequestException('locale is a required param'));

    expect(response.statusCode).toBe(400);
    expect(response.body).toEqual({ error: { code: 'BadRequest', message: 'Your request seems to be invalid or malformed' } });
  });
});
