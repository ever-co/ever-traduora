import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { NO_ERRORS_SCHEMA } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { NgxsModule, Store } from '@ngxs/store';
import { AuthState, ConfirmProviderSignup } from '../../stores/auth.state';
import { EverIdConfirmComponent } from './everid-confirm.component';

describe('EverIdConfirmComponent', () => {
  let store: Store;

  const render = (pendingSignup: any) => {
    store.reset({ ...store.snapshot(), auth: { ...store.snapshot().auth, pendingSignup } });
    const fixture = TestBed.createComponent(EverIdConfirmComponent);
    fixture.detectChanges();
    return fixture;
  };

  beforeEach(() => {
    TestBed.configureTestingModule({
      declarations: [EverIdConfirmComponent],
      imports: [NgxsModule.forRoot([AuthState])],
      providers: [provideHttpClient(), provideHttpClientTesting()],
      schemas: [NO_ERRORS_SCHEMA],
    });
    store = TestBed.inject(Store);
  });

  it('shows the name and email read-only, and every invitation unchecked', () => {
    const fixture = render({
      pending: 'v1.sealed',
      name: 'New Person',
      email: 'new@example.test',
      invites: [
        { id: 'i1', projectName: 'Docs' },
        { id: 'i2', projectName: 'App' },
      ],
    });
    const text = fixture.nativeElement.textContent;
    expect(text).toContain('Create your Traduora account');
    const name = fixture.debugElement.query(By.css('#everIdNameInput')).nativeElement as HTMLInputElement;
    const email = fixture.debugElement.query(By.css('#everIdEmailInput')).nativeElement as HTMLInputElement;
    expect(name.value).toBe('New Person');
    expect(name.readOnly).toBeTrue();
    expect(email.value).toBe('new@example.test');
    expect(email.readOnly).toBeTrue();
    const boxes = fixture.debugElement.queryAll(By.css('input[type=checkbox]')).map(box => box.nativeElement as HTMLInputElement);
    expect(boxes.length).toBe(2);
    expect(boxes.every(box => !box.checked)).toBeTrue();
    expect(text).toContain('Docs');
    expect(text).toContain('App');
  });

  it('creates the account with only the ticked invitations', () => {
    const fixture = render({
      pending: 'v1.sealed',
      name: 'N',
      email: 'e',
      invites: [
        { id: 'i1', projectName: 'Docs' },
        { id: 'i2', projectName: 'App' },
      ],
    });
    const dispatch = spyOn(store, 'dispatch').and.callThrough();
    const second = fixture.debugElement.queryAll(By.css('input[type=checkbox]'))[1].nativeElement as HTMLInputElement;
    second.click();
    fixture.detectChanges();
    const create = fixture.debugElement.queryAll(By.css('button')).find(button => button.nativeElement.textContent.includes('Create account'));
    dispatch.and.stub();
    create.nativeElement.click();
    expect(dispatch).toHaveBeenCalledWith(new ConfirmProviderSignup(['i2']));
  });

  it('asks to sign in again when there is nothing to confirm', () => {
    const fixture = render(undefined);
    expect(fixture.nativeElement.textContent).toContain('This sign-up expired');
    expect(fixture.debugElement.query(By.css('input'))).toBeNull();
  });
});
