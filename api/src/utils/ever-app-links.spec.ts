import { EVER_APP_IDS, formatEverAppLinks, parseEverAppLinks } from './ever-app-links';

describe('parseEverAppLinks', () => {
  it('is empty when the variable is not set', () => {
    expect(parseEverAppLinks(undefined).size).toBe(0);
    expect(parseEverAppLinks('').size).toBe(0);
    expect(parseEverAppLinks(' , ,').size).toBe(0);
  });

  it('reads id=url pairs, trimmed, in the order given', () => {
    const links = parseEverAppLinks(' platform = https://app.example , tech=https://tech.example/hire ,rec=http://localhost:3000');

    expect([...links]).toEqual([
      ['platform', 'https://app.example/'],
      ['tech', 'https://tech.example/hire'],
      ['rec', 'http://localhost:3000/'],
    ]);
  });

  it('knows the eight Ever apps, Ever Tech included', () => {
    expect([...EVER_APP_IDS]).toEqual(['platform', 'works', 'teams', 'gauzy', 'rec', 'traduora', 'demand', 'tech']);
  });

  it('ignores unknown ids, entries without "=", links that are not http(s) and malformed links', () => {
    const links = parseEverAppLinks(
      'cloc=https://cloc.example,works,=https://x.example,teams=javascript:alert(1),gauzy=ftp://gauzy.example,rec=not a url,Platform=https://upper.example',
    );

    expect(links.size).toBe(0);
  });

  it('keeps an "=" inside the link and lets a later pair win', () => {
    const links = parseEverAppLinks('platform=https://one.example/?a=b,platform=https://two.example');

    expect(links.get('platform')).toBe('https://two.example/');
    expect(parseEverAppLinks('works=https://w.example/?a=b').get('works')).toBe('https://w.example/?a=b');
  });

  it('formats the links back in the same format', () => {
    expect(formatEverAppLinks(parseEverAppLinks('works=https://w.example,platform=https://p.example'))).toBe(
      'works=https://w.example/,platform=https://p.example/',
    );
  });
});
