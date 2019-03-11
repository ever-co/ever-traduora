import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { Payload } from 'src/app/shared/models/http';
import { User } from '../models/user';
import { UserLogin } from '../models/user-login';
import { UserSignup } from '../models/user-signup';
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

  signup(data: UserSignup): Observable<{ accessToken: string } & User> {
    return this.http.post<Payload<{ accessToken: string } & User>>(`${this.endpoint}/auth/signup`, data).pipe(map(res => res.data));
  }

  login(data: UserLogin): Observable<{ accessToken: string }> {
    return this.http
      .post<Payload<{ accessToken: string }>>(`${this.endpoint}/auth/token`, {
        ...data,
        grantType: 'password',
      })
      .pipe(map(res => res.data));
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
