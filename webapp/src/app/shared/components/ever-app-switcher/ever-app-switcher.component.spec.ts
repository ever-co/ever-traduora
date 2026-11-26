import { ComponentFixture, TestBed } from '@angular/core/testing';
import { EverAppSwitcherComponent } from './ever-app-switcher.component';
import { buildEverAppSwitcher, EVER_APP_ENTRIES, parseEverAppLinks, readEverAppLinks } from './ever-apps';

// The value an Ever deployment sets: every Ever app's host for that environment (test hosts here).
const ALL_LINKS = [
  'platform=https://app.platform.test',
  'works=https://app.works.test',
  'teams=https://app.teams.test',
  'gauzy=https://app.gauzy.test',
  'rec=https://app.rec.test',
  'traduora=https://app.traduora.test',
  'demand=https://app.demand.test',
  'tech=https://tech.test',
].join(',');

describe('Ever app catalog', () => {
  it('lists the eight Ever apps in the shared order, Ever Tech last', () => {
    expect(EVER_APP_ENTRIES.map(app => app.name)).toEqual([
      'Ever Platform',
      'Ever Works',
      'Ever Teams',
      'Ever Gauzy',
      'Ever Rec',
      'Ever Traduora',
      'Ever Demand',
      'Ever Tech',
    ]);
    expect(EVER_APP_ENTRIES.every(app => app.line.length > 0 && !/https?:|\.(co|so|team|works|tech)\b/.test(app.line))).toBe(true);
  });

  it('parses id=url pairs and ignores unknown ids and links that are not http(s)', () => {
    const links = parseEverAppLinks(' works = https://w.test ,cloc=https://c.test,teams=javascript:alert(1),gauzy,rec=ftp://r.test');

    expect([...links]).toEqual([['works', 'https://w.test/']]);
    expect(parseEverAppLinks(undefined).size).toBe(0);
  });

  it('shows no switcher unless another app is linked', () => {
    expect(buildEverAppSwitcher(parseEverAppLinks(''))).toBeUndefined();
    expect(buildEverAppSwitcher(parseEverAppLinks('traduora=https://app.traduora.test'))).toBeUndefined();
  });

  it('derives "+ Add" from the Ever Platform link, and leaves it out without one', () => {
    expect(buildEverAppSwitcher(parseEverAppLinks('platform=https://app.platform.test/o/acme')).addUrl).toBe(
      'https://app.platform.test/apps?add=app',
    );
    expect(buildEverAppSwitcher(parseEverAppLinks('works=https://app.works.test')).addUrl).toBeUndefined();
  });

  it('keeps Ever Demand as "Soon" while it has no link, and drops other unlinked apps', () => {
    const switcher = buildEverAppSwitcher(parseEverAppLinks('works=https://app.works.test'));

    expect(switcher.apps.map(app => [app.id, app.url ?? null, app.current])).toEqual([
      ['works', 'https://app.works.test/', false],
      ['traduora', null, true],
      ['demand', null, false],
    ]);
  });
});

describe('EverAppSwitcherComponent', () => {
  let marker: HTMLMetaElement | undefined;

  const setLinks = (content: string) => {
    marker = document.createElement('meta');
    marker.name = 'ever-app-links';
    marker.content = content;
    document.head.appendChild(marker);
  };

  const render = (): ComponentFixture<EverAppSwitcherComponent> => {
    TestBed.configureTestingModule({ imports: [EverAppSwitcherComponent] });
    const fixture = TestBed.createComponent(EverAppSwitcherComponent);
    fixture.detectChanges();
    return fixture;
  };

  const trigger = (fixture: ComponentFixture<EverAppSwitcherComponent>): HTMLButtonElement =>
    fixture.nativeElement.querySelector('[data-testid="ever-app-switcher"]');

  const open = (fixture: ComponentFixture<EverAppSwitcherComponent>): HTMLElement => {
    trigger(fixture).click();
    fixture.detectChanges();
    return fixture.nativeElement.querySelector('[data-testid="ever-app-panel"]');
  };

  afterEach(() => {
    marker?.remove();
    marker = undefined;
  });

  it('renders nothing on an install without Ever app links', () => {
    expect(readEverAppLinks()).toBeUndefined();

    const fixture = render();

    expect(fixture.nativeElement.querySelector('*')).toBeNull();
    expect(trigger(fixture)).toBeNull();
  });

  it('opens the "Apps" panel from the Ever mark, with eight rows and "+ Add"', () => {
    setLinks(ALL_LINKS);
    const fixture = render();

    expect(trigger(fixture).getAttribute('aria-label')).toBe('Switch to another Ever platform or app');
    expect(trigger(fixture).getAttribute('aria-expanded')).toBe('false');

    const panel = open(fixture);

    expect(trigger(fixture).getAttribute('aria-expanded')).toBe('true');
    expect(panel.classList).toContain('show');
    expect(panel.querySelector('.ever-app-title').textContent.trim()).toBe('Apps');
    const rows = Array.from(panel.querySelectorAll<HTMLElement>('[data-ever-app]'));
    expect(rows.map(row => row.dataset.everApp)).toEqual(['platform', 'works', 'teams', 'gauzy', 'rec', 'traduora', 'demand', 'tech']);
    expect(rows.map(row => row.querySelector('.ever-app-line').textContent.trim())).toEqual(EVER_APP_ENTRIES.map(app => app.line));
    expect(panel.querySelector('[data-testid="ever-app-add"] .ever-app-name').textContent.trim()).toBe('Add');
  });

  it('opens every other app in the same tab, at its app host, and never shows a host', () => {
    setLinks(ALL_LINKS);
    const panel = open(render());

    const links = Array.from(panel.querySelectorAll<HTMLAnchorElement>('a'));
    expect(links.map(link => link.getAttribute('href'))).toEqual([
      'https://app.platform.test/',
      'https://app.works.test/',
      'https://app.teams.test/',
      'https://app.gauzy.test/',
      'https://app.rec.test/',
      'https://app.demand.test/',
      'https://tech.test/',
      'https://app.platform.test/apps?add=app',
    ]);
    expect(links.every(link => !link.hasAttribute('target') && !link.hasAttribute('rel'))).toBe(true);
    expect(panel.textContent).not.toMatch(/\.test|https?:|new tab/i);
  });

  it('marks Ever Traduora as the current app, with a check and no link', () => {
    setLinks(ALL_LINKS);
    const panel = open(render());

    const current = panel.querySelector<HTMLElement>('[aria-current="page"]');
    expect(current.dataset.everApp).toBe('traduora');
    expect(current.tagName).toBe('DIV');
    expect(current.querySelector('.ever-app-mark').textContent.trim()).toBe('check');
    expect(panel.querySelectorAll('[aria-current]').length).toBe(1);
  });

  it('labels "+ Add" for Ever Platform and hides it when Ever Platform is not linked', () => {
    setLinks(ALL_LINKS);
    const add = open(render()).querySelector('[data-testid="ever-app-add"]');
    expect(add.getAttribute('aria-label')).toBe('Add your own apps in Ever Platform');
    expect(add.getAttribute('title')).toBe('Add your own apps in Ever Platform');

    marker.remove();
    TestBed.resetTestingModule();
    setLinks('works=https://app.works.test');
    expect(open(render()).querySelector('[data-testid="ever-app-add"]')).toBeNull();
  });

  it('keeps the panel inside the screen height, scrolling when the rows do not fit', () => {
    setLinks(ALL_LINKS);
    const fixture = render();
    document.body.appendChild(fixture.nativeElement);
    const panel = open(fixture);

    const room = window.innerHeight - trigger(fixture).getBoundingClientRect().bottom - 10;
    expect(panel.style.maxHeight).toBe(`${Math.max(1, Math.floor(room))}px`);
    expect(getComputedStyle(panel).overflowY).toBe('auto');
    fixture.nativeElement.remove();
  });

  it('fits the panel again when the window is resized while it is open', () => {
    setLinks(ALL_LINKS);
    const fixture = render();
    const panel = open(fixture);
    panel.style.maxHeight = '1px';

    window.dispatchEvent(new Event('resize'));

    expect(panel.style.maxHeight).not.toBe('1px');
    expect(panel.style.maxHeight).toMatch(/^[0-9]+px$/);
  });

  it('closes on Escape and gives the focus back to the mark', () => {
    setLinks(ALL_LINKS);
    const fixture = render();
    document.body.appendChild(fixture.nativeElement);
    const panel = open(fixture);

    panel.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    fixture.detectChanges();

    expect(trigger(fixture).getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(trigger(fixture));
    fixture.nativeElement.remove();
  });
});
