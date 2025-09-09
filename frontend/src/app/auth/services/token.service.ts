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
