import { Component, OnDestroy, OnInit } from '@angular/core';
import { UntypedFormBuilder, Validators } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { Select, Store } from '@ngxs/store';
import { Observable, Subscription } from 'rxjs';
import { tap } from 'rxjs/operators';
import { Project } from '../../models/project';
import { ClearMessages, DeleteProject, ProjectsState, ReloadCurrentProject, UpdateProject } from '../../stores/projects.state';

@Component({
  selector: 'app-project-settings',
  templateUrl: './project-settings.component.html',
  styleUrls: ['./project-settings.component.css'],
})
export class ProjectSettingsComponent implements OnInit, OnDestroy {
  detailsForm = this.fb.group({
    name: ['', Validators.compose([Validators.required, Validators.pattern('.*[^ ].*')])],
    description: [''],
  });

  @Select(ProjectsState.currentProject)
  project$: Observable<Project | undefined>;

  @Select(ProjectsState.isLoading)
  isLoading$: Observable<boolean>;

  @Select(state => state.projects.errorMessage)
  errorMessage$: Observable<string | undefined>;

  sub: Subscription;

  constructor(
    private fb: UntypedFormBuilder,
    private store: Store,
    private route: ActivatedRoute,
  ) {}

  ngOnInit() {
    this.store.dispatch(new ReloadCurrentProject());
    this.sub = this.project$
      .pipe(
        tap(project => {
          this.name.setValue(project.name);
          this.description.setValue(project.description);
        }),
      )
      .subscribe();
  }

  ngOnDestroy() {
    this.store.dispatch(new ClearMessages());
    this.sub.unsubscribe();
  }

  get name() {
    return this.detailsForm.get('name');
  }

  get description() {
    return this.detailsForm.get('description');
  }

  onSubmit(id: string) {
    if (!this.detailsForm.valid) {
      return;
    }
    this.store.dispatch(new ClearMessages());
    this.store.dispatch(
      new UpdateProject(id, {
        name: this.name.value as string,
        description: this.description.value as string,
      }),
    );
  }

  onDelete(project: Project) {
    const ok = confirm(`Are you sure you want to delete the project: ${project.name}?`);
    if (!ok) {
      return;
    }
    const response = prompt(`Please type in the project name (${project.name}) to confirm delete.`);
    if (response !== project.name) {
      return;
    }
    this.store.dispatch(new DeleteProject(project.id));
  }

  currentUsage(project: Project): number {
    return project.termsCount * project.localesCount;
  }
}
