/**
 * The Ever app switcher's links, from `EVER_APP_LINKS`: `id=url` pairs joined by commas, for example
 * `platform=https://app.ever.co,works=https://app.ever.works`. Every Ever app reads the same format (homelab
 * `docs/handoffs/HANDOVER-2026-11-26-ever-app-switcher-in-apps.md` §3.2). Unknown ids, entries without `=` and links
 * that are not http(s) are ignored; spaces around ids and links are trimmed.
 *
 * No Ever host is written in this code: the links come only from the deployment, so a self-hosted install that does
 * not set the variable shows no switcher at all.
 */
export const EVER_APP_IDS = ['platform', 'works', 'teams', 'gauzy', 'rec', 'traduora', 'demand', 'tech'] as const;

export type EverAppId = (typeof EVER_APP_IDS)[number];

const isEverAppId = (id: string): id is EverAppId => (EVER_APP_IDS as ReadonlyArray<string>).includes(id);

/** The link as an absolute http(s) URL, or undefined when it is not one. */
const httpUrl = (value: string): string | undefined => {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : undefined;
  } catch {
    return undefined;
  }
};

export const parseEverAppLinks = (raw: string | undefined): Map<EverAppId, string> => {
  const links = new Map<EverAppId, string>();
  for (const entry of (raw ?? '').split(',')) {
    const separator = entry.indexOf('=');
    if (separator <= 0) {
      continue;
    }
    const id = entry.slice(0, separator).trim();
    const url = httpUrl(entry.slice(separator + 1).trim());
    if (isEverAppId(id) && url) {
      links.set(id, url);
    }
  }
  return links;
};

/** The links back in the `id=url,id=url` format, normalized: what the API hands the web app. */
export const formatEverAppLinks = (links: ReadonlyMap<EverAppId, string>): string => [...links].map(([id, url]) => `${id}=${url}`).join(',');
