export type EverAppId = 'platform' | 'works' | 'teams' | 'gauzy' | 'rec' | 'traduora' | 'demand' | 'tech';

export interface EverAppEntry {
  id: EverAppId;
  /** The product's full name, the same in every Ever app. */
  name: string;
  /** One short line under the name, so people know which app they would switch to. */
  line: string;
  logo: string;
  /** Listed as "Soon", without a link, while the deployment gives it none. */
  soon?: boolean;
}

export interface EverAppRow extends EverAppEntry {
  /** Undefined for this app (the current row) and for an app that is coming soon without a link. */
  url?: string;
  current: boolean;
}

export interface EverAppSwitcher {
  apps: ReadonlyArray<EverAppRow>;
  /** Where people add their own apps: Ever Platform's `/apps?add=app`. Undefined when Ever Platform is not linked. */
  addUrl?: string;
}

export const CURRENT_EVER_APP_ID: EverAppId = 'traduora';

/** The tag the API adds to index.html when the install sets `EVER_APP_LINKS`. */
export const EVER_APP_LINKS_META_NAME = 'ever-app-links';

// Same list, order and lines in every Ever app and site (homelab docs/brand/EVER-SITES-UNIFIED-CHROME.md §4 and §4b,
// docs/handoffs/HANDOVER-2026-11-26-ever-app-switcher-in-apps.md §2b and §3). Keep the copies in sync.
// No link lives here: each one comes from the deployment (EVER_APP_LINKS, served by the API), so a self-hosted
// install never sends its people to Ever's hosted apps.
export const EVER_APP_ENTRIES: ReadonlyArray<EverAppEntry> = [
  { id: 'platform', name: 'Ever Platform', line: 'One account for every Ever app', logo: 'assets/ever-apps/platform.svg' },
  { id: 'works', name: 'Ever Works', line: 'AI agents that run your business', logo: 'assets/ever-apps/works.svg' },
  { id: 'teams', name: 'Ever Teams', line: 'Work and project management', logo: 'assets/ever-apps/teams.svg' },
  { id: 'gauzy', name: 'Ever Gauzy', line: 'ERP, CRM and HR in one app', logo: 'assets/ever-apps/gauzy.svg' },
  { id: 'rec', name: 'Ever Rec', line: 'Screen capture and recording', logo: 'assets/ever-apps/rec.svg' },
  { id: 'traduora', name: 'Ever Traduora', line: 'Translation management for teams', logo: 'assets/ever-apps/traduora.png' },
  { id: 'demand', name: 'Ever Demand', line: 'Commerce and on-demand marketplaces', logo: 'assets/ever-apps/demand.svg', soon: true },
  { id: 'tech', name: 'Ever Tech', line: 'Engineers and operated agents for hire', logo: 'assets/ever-apps/tech.svg' },
];

const KNOWN_IDS = new Set<string>(EVER_APP_ENTRIES.map(app => app.id));

const httpUrl = (value: string): string | undefined => {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : undefined;
  } catch {
    return undefined;
  }
};

/**
 * `id=url` pairs joined by commas, the format of every Ever app (`EVER_APP_LINKS`). Unknown ids, entries without `=`
 * and links that are not http(s) are ignored. The API already normalizes the value; this parses it again so the page
 * never links to anything else.
 */
export const parseEverAppLinks = (raw: string | null | undefined): Map<EverAppId, string> => {
  const links = new Map<EverAppId, string>();
  for (const entry of (raw ?? '').split(',')) {
    const separator = entry.indexOf('=');
    if (separator <= 0) {
      continue;
    }
    const id = entry.slice(0, separator).trim();
    const url = httpUrl(entry.slice(separator + 1).trim());
    if (KNOWN_IDS.has(id) && url) {
      links.set(id as EverAppId, url);
    }
  }
  return links;
};

/** The links the API put in the page, or undefined on an install that sets none. */
export const readEverAppLinks = (doc: Document = document): string | undefined =>
  doc.querySelector(`meta[name="${EVER_APP_LINKS_META_NAME}"]`)?.getAttribute('content') ?? undefined;

/**
 * The switcher for these links: every linked app, this one as the current row, Ever Demand as "Soon" while it has no
 * link, and "+ Add" when Ever Platform is linked. Undefined (no switcher at all) unless at least one other app is
 * linked, so a self-hosted install shows nothing Ever-specific.
 */
export const buildEverAppSwitcher = (links: ReadonlyMap<EverAppId, string>): EverAppSwitcher | undefined => {
  const apps: EverAppRow[] = [];
  for (const entry of EVER_APP_ENTRIES) {
    const current = entry.id === CURRENT_EVER_APP_ID;
    const url = current ? undefined : links.get(entry.id);
    if (current || url || entry.soon) {
      apps.push({ ...entry, url, current });
    }
  }
  if (!apps.some(app => app.url)) {
    return undefined;
  }
  const platform = links.get('platform');
  return { apps, addUrl: platform ? new URL('/apps?add=app', platform).href : undefined };
};
