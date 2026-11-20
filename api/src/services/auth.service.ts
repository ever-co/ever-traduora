import { BadRequestException, Injectable } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { stringify, unescape } from 'querystring';
import { config } from '../config';
import { OidcProviderService } from './oidc-provider.service';

@Injectable()
export class AuthService {
  constructor(
    private readonly httpService: HttpService,
    private readonly oidcProviders: OidcProviderService,
  ) {}

  async getTokenFromGoogle(code: string): Promise<any> {
    return this.getTokenFromProvider('google', code);
  }

  /**
   * Exchanges an authorization code at the provider's token endpoint. Google keeps its exact request; an OpenID
   * Connect provider (e.g. Ever ID) also needs the PKCE verifier of the authorization request.
   */
  async getTokenFromProvider(slug: string, code: string, codeVerifier?: string): Promise<any> {
    if (slug !== 'google') {
      return this.oidcProviders.exchangeCode(slug, code, codeVerifier);
    }

    const { active, apiUrl, clientId, clientSecret, redirectUrl } = config.providers.google;

    if (!active) {
      throw new BadRequestException('Google authentication provider is not enabled');
    }

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
