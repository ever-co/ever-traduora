import { ComponentFixture, TestBed } from '@angular/core/testing';
import { DemoBannerComponent, isDemoInstall } from './demo-banner.component';

describe('DemoBannerComponent', () => {
  let marker: HTMLMetaElement | undefined;

  const addDemoMarker = () => {
    marker = document.createElement('meta');
    marker.name = 'traduora-demo';
    marker.content = 'true';
    document.head.appendChild(marker);
  };

  const render = (): ComponentFixture<DemoBannerComponent> => {
    TestBed.configureTestingModule({ declarations: [DemoBannerComponent] });
    const fixture = TestBed.createComponent(DemoBannerComponent);
    fixture.detectChanges();
    return fixture;
  };

  afterEach(() => {
    marker?.remove();
    marker = undefined;
  });

  it('renders nothing when the page has no demo tag', () => {
    expect(isDemoInstall()).toBe(false);

    const fixture = render();

    expect(fixture.nativeElement.querySelector('[data-testid="demo-banner"]')).toBeNull();
  });

  it('shows the notice and links to the Traduora homepage on a demo install', () => {
    addDemoMarker();
    expect(isDemoInstall()).toBe(true);

    const fixture = render();
    const banner: HTMLElement = fixture.nativeElement.querySelector('[data-testid="demo-banner"]');

    expect(banner).not.toBeNull();
    expect(banner.textContent).toContain('You are using a demo account.');
    expect(banner.querySelector('a').getAttribute('href')).toBe('https://traduora.co');
  });
});
