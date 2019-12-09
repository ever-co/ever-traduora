import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { Payload } from 'src/app/shared/models/http';
import { environment } from '../../../environments/environment';
import { ProjectStats } from '../models/project-stats';

@Injectable({
  providedIn: 'root',
})
export class ProjectStatsService {
  private endpoint = environment.apiEndpoint;

  constructor(private http: HttpClient) {}

  getStats(id: string): Observable<ProjectStats> {
    return this.http.get<Payload<ProjectStats>>(`${this.endpoint}/projects/${id}/stats`).pipe(map(res => res.data));
  }
}
