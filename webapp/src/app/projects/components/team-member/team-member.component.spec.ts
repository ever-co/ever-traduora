import { NO_ERRORS_SCHEMA } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ProjectRole } from '../../models/project-role';
import { ProjectUser } from '../../models/project-user';
import { TeamMemberComponent } from './team-member.component';

describe('TeamMemberComponent', () => {
  const render = (canDelete: boolean): ComponentFixture<TeamMemberComponent> => {
    TestBed.configureTestingModule({ declarations: [TeamMemberComponent], schemas: [NO_ERRORS_SCHEMA] });
    const fixture = TestBed.createComponent(TeamMemberComponent);
    const user = new ProjectUser();
    user.userId = 'u1';
    user.name = 'Ada Lovelace';
    user.email = 'ada@example.com';
    user.role = ProjectRole.Editor;
    fixture.componentInstance.user = user;
    fixture.componentInstance.canDelete = canDelete;
    fixture.detectChanges();
    return fixture;
  };

  it('names the remove button after the member and hides its icon from assistive tech', () => {
    const fixture = render(true);
    const button: HTMLButtonElement = fixture.nativeElement.querySelector('button');

    expect(button).not.toBeNull();
    expect(button.getAttribute('type')).toBe('button');
    expect(button.getAttribute('aria-label')).toContain('Ada Lovelace');
    expect(button.querySelector('i.material-icons').getAttribute('aria-hidden')).toBe('true');
  });

  it('emits the member when the remove button is clicked', () => {
    const fixture = render(true);
    const emitted: ProjectUser[] = [];
    fixture.componentInstance.remove.subscribe((u: ProjectUser) => emitted.push(u));

    fixture.nativeElement.querySelector('button').click();

    expect(emitted).toEqual([fixture.componentInstance.user]);
  });

  it('renders no remove button when the member cannot be deleted', () => {
    const fixture = render(false);

    expect(fixture.nativeElement.querySelector('button')).toBeNull();
  });
});
