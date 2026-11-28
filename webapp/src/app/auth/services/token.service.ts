import { Injectable } from '@angular/core';
import jwtDecode from 'jwt-decode';

@Injectable({
  providedIn: 'root',
})
export class TokenService {
  private readonly tokenKey = 'accessToken';

  getToken(): string | undefined {
    return localStorage.getItem(this.tokenKey);
  }

  setToken(token: string) {
    localStorage.setItem(this.tokenKey, token);
  }

  clearToken() {
    localStorage.removeItem(this.tokenKey);
  }

  /** The account the stored token signs in (its `sub`), or undefined without a readable token */
  userId(): string | undefined {
    const token = this.getToken();
    if (!token) {
      return undefined;
    }
    try {
      const claims = jwtDecode(token) as { sub?: unknown };
      return typeof claims.sub === 'string' ? claims.sub : undefined;
    } catch {
      return undefined;
    }
  }

  isTokenValid(): boolean {
    const token = this.getToken();
    if (!token) {
      return false;
    }
    const claims = jwtDecode(token) as { iat: number; exp: number; sub: string };
    const now = Math.round(new Date().getTime() / 1000);
    const expired = claims.exp <= now;
    return !expired;
  }
}
