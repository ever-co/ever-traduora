import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { map, tap } from 'rxjs/operators';
import { Payload } from 'src/app/shared/models/http';
import { Provider } from '../models/provider';
import { User } from '../models/user';
import { UserLogin, UserLoginWithProvider } from '../models/user-login';
import { UserSignup, UserSignupWithProvider } from '../models/user-signup';
import { environment } from './../../../environments/environment';

@Injectable({
  providedIn: 'root',
})
export class AuthService {
  private endpoint = environment.apiEndpoint;

  constructor(private http: HttpClient) {}

  getUserSelf(): Observable<User> {
    return this.http.get<Payload<User>>(`${this.endpoint}/users/me`).pipe(map(res => res.data));
  }

  updateUserSelf(updates: { name?: string; email?: string }): Observable<User> {
    return this.http.patch<Payload<User>>(`${this.endpoint}/users/me`, updates).pipe(map(res => res.data));
  }

  getProviders(): Observable<Provider[]> {
    return this.http.get<Payload<Provider[]>>(`${this.endpoint}/auth/providers`).pipe(map(res => res.data));
  }

  signup(data: UserSignup): Observable<{ accessToken: string } & User> {
    return this.http.post<Payload<{ accessToken: string } & User>>(`${this.endpoint}/auth/signup`, data).pipe(map(res => res.data));
  }

  signupWithProvider(data: UserSignupWithProvider): Observable<{ accessToken: string } & User> {
    return this.http.post<Payload<{ accessToken: string } & User>>(`${this.endpoint}/auth/signup-provider`, data).pipe(
      map(res => res.data),
      tap(() => window.close()),
    );
  }

  login(data: UserLogin): Observable<{ accessToken: string }> {
    return this.http
      .post<Payload<{ accessToken: string }>>(`${this.endpoint}/auth/token`, {
        ...data,
        grantType: 'password',
      })
      .pipe(map(res => res.data));
  }

  loginWithProvider(data: UserLoginWithProvider) {
    return this.http
      .post<Payload<{ accessToken: string }>>(`${this.endpoint}/auth/token`, {
        ...data,
        grantType: 'provider',
      })
      .pipe(map(res => res.data));
  }

  redirectWithProvider({ type, provider }: { type: 'login' | 'signup'; provider: Provider }) {
    window.open(
      `${provider.url}?redirect_uri=${provider.redirectUrl}&state=${type}&client_id=${
        provider.clientId
      }&scope=email profile openid&access_type=offline&prompt=select_account&response_type=code`,
      '_blank',
      'width=500,height=750',
    );
  }

  deleteAccount(): Observable<any> {
    return this.http.delete<any>(`${this.endpoint}/users/me`);
  }

  forgotPassword(email: string): Observable<any> {
    return this.http.post(`${this.endpoint}/auth/forgot-password`, { email: email }, { responseType: 'text' });
  }

  resetPassword(data: { email: string; newPassword: string; token: string }): Observable<any> {
    return this.http.post(`${this.endpoint}/auth/reset-password`, data, { responseType: 'text' });
  }

  changePassword(data: { oldPassword: string; newPassword: string }): Observable<any> {
    return this.http.post(`${this.endpoint}/auth/change-password`, data, { responseType: 'text' });
  }
}
