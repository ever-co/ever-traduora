import { TestBed } from '@angular/core/testing';
import { TURNSTILE_SCRIPT, TurnstileApi, TurnstileComponent, TurnstileLoader } from './turnstile.component';

describe('TurnstileComponent', () => {
  let api: jasmine.SpyObj<TurnstileApi>;
  let options: Parameters<TurnstileApi['render']>[1];

  const create = async (load: () => Promise<TurnstileApi>) => {
    TestBed.configureTestingModule({
      imports: [TurnstileComponent],
      providers: [{ provide: TurnstileLoader, useValue: { load } }],
    });
    const fixture = TestBed.createComponent(TurnstileComponent);
    fixture.componentRef.setInput('siteKey', 'site-key');
    fixture.componentRef.setInput('action', 'signup');
    const tokens: Array<string | undefined> = [];
    fixture.componentInstance.token.subscribe(token => tokens.push(token));
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    return { fixture, tokens };
  };

  beforeEach(() => {
    api = jasmine.createSpyObj<TurnstileApi>('turnstile', ['render', 'reset', 'remove']);
    api.render.and.callFake((_element, given) => {
      options = given;
      return 'widget-1';
    });
  });

  it('renders the check with the site key and action, and hands its token on', async () => {
    const { fixture, tokens } = await create(() => Promise.resolve(api));
    expect(options).toEqual(jasmine.objectContaining({ sitekey: 'site-key', action: 'signup', theme: 'light', size: 'flexible' }));
    options.callback('the-token');
    options['expired-callback']();
    expect(tokens).toEqual(['the-token', undefined]);

    // A refused submit asks for a fresh check
    fixture.componentInstance.reset();
    expect(api.reset).toHaveBeenCalledWith('widget-1');
    fixture.destroy();
    expect(api.remove).toHaveBeenCalledWith('widget-1');
  });

  it('says so when the script cannot load', async () => {
    const { fixture } = await create(() => Promise.reject(new Error('blocked')));
    expect(fixture.nativeElement.textContent).toContain('The bot check could not load');
    expect(api.render).not.toHaveBeenCalled();
  });
});

describe('TurnstileLoader', () => {
  afterEach(() => delete (window as any).turnstile);

  it("adds Cloudflare's script once and answers its API", async () => {
    // The script is caught before it reaches the page: the test never loads anything from Cloudflare
    const added: HTMLScriptElement[] = [];
    spyOn(document.head, 'appendChild').and.callFake(<T extends Node>(node: T) => {
      added.push(node as unknown as HTMLScriptElement);
      return node;
    });
    const loader = new TurnstileLoader();
    const first = loader.load();
    const second = loader.load();
    expect(added.map(script => script.src)).toEqual([TURNSTILE_SCRIPT]);
    const fake = { render: () => 'w', reset: () => undefined, remove: () => undefined };
    (window as any).turnstile = fake;
    added[0].onload(new Event('load'));
    expect(await first).toBe(fake);
    expect(await second).toBe(fake);
    expect(await loader.load()).toBe(fake);
    expect(added.length).toBe(1);
  });

  it('asks again after the script failed to load', async () => {
    const added: HTMLScriptElement[] = [];
    spyOn(document.head, 'appendChild').and.callFake(<T extends Node>(node: T) => {
      added.push(node as unknown as HTMLScriptElement);
      return node;
    });
    const loader = new TurnstileLoader();
    const failed = loader.load();
    added[0].onerror(new Event('error'));
    await expectAsync(failed).toBeRejected();
    void loader.load().catch(() => undefined);
    expect(added.length).toBe(2);
  });
});
