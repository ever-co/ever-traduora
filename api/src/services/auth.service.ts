import { BadRequestException, HttpService, Injectable } from '@nestjs/common';
import { stringify, unescape } from 'querystring';
import { config } from '../config';

@Injectable()
export class AuthService {
  constructor(private readonly httpService: HttpService) {}

  async getTokenFromGoogle(code: string): Promise<any> {
    const { apiUrl, clientId, clientSecret, redirectUrl } = config.providers.google;

    try {
      const body = stringify(
        {
          access_type: 'offline',
          code,
          client_id: clientId,
          client_secret: clientSecret,
          redirect_uri: redirectUrl,
          grant_type: 'authorization_code',
        },
        null,
        null,
        { encodeURIComponent: unescape },
      );
      const { data } = await this.httpService
        .post(apiUrl, body, {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          },
        })
        .toPromise();
      return data;
    } catch (err) {
      throw new BadRequestException();
    }
  }
}
