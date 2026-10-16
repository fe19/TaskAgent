/**
 * Which websites an agent may reach. Access is per site (host): allowing www.bbc.co.uk allows
 * every page under it, such as www.bbc.co.uk/news. `*.example.com` allows its subdomains.
 * Pure; also used in the browser.
 */

/** "https://WWW.BBC.co.uk/news?x" or "www.bbc.co.uk/news" → "www.bbc.co.uk". Null if it isn't a site. */
export function siteOf(value) {
  const host = String(value ?? '')
    .trim()
    .replace(/^[a-z][a-z0-9+.-]*:\/\//i, '')
    .replace(/[/?#].*$/, '')
    .replace(/:\d+$/, '')
    .replace(/\.$/, '')
    .toLowerCase();
  return /^(\*\.)?[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(host) ? host : null;
}

/** File names look like domains ("notes.md"); these endings never count as a website. */
const FILE_ENDINGS = new Set([
  'md', 'js', 'mjs', 'ts', 'tsx', 'jsx', 'json', 'py', 'txt', 'csv', 'html', 'css', 'yml', 'yaml',
  'xml', 'sh', 'rb', 'go', 'rs', 'java', 'c', 'h', 'cpp', 'png', 'jpg', 'jpeg', 'gif', 'svg', 'pdf',
  'zip', 'lock', 'log', 'env', 'toml', 'ini', 'sql', 'db',
]);

/**
 * Sites a text points to: full URLs ("https://x.org/a"), www. names, and names followed by a
 * path ("bbc.co.uk/news"). A bare "notes.md" or "example.com" in prose is not counted.
 */
export function sitesIn(text) {
  const found = new Set();
  const patterns = [
    /\bhttps?:\/\/([^\s/?#'"<>)\]]+)/gi,
    /(?<![\w.-])(www\.[a-z0-9-]+(?:\.[a-z0-9-]+)+)/gi,
    /(?<![\w./-])([a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,})(?=\/)/gi,
  ];
  for (const pattern of patterns) {
    for (const match of String(text ?? '').matchAll(pattern)) {
      const site = siteOf(match[1]);
      if (site && !FILE_ENDINGS.has(site.split('.').at(-1))) found.add(site);
    }
  }
  return [...found];
}

/** Whether `site` is covered by one of `allowed` (exact, or under a `*.` entry). */
export function isSiteAllowed(site, allowed) {
  const host = siteOf(site);
  if (!host) return false;
  return allowed.some((entry) => {
    const rule = siteOf(entry);
    if (!rule) return false;
    if (rule.startsWith('*.')) return host.endsWith(rule.slice(1)) || host === rule.slice(2);
    return host === rule;
  });
}

/** The sites in `text` that none of the lists allows, in order of appearance. */
export function sitesNotAllowed(text, ...lists) {
  const allowed = lists.flat();
  return sitesIn(text).filter((site) => !isSiteAllowed(site, allowed));
}

/**
 * Whether every website (except blocked ones) is open to the selected assistant. Only Claude
 * Code's sandbox can express "all"; sandbox-runtime, which wraps Copilot, refuses it.
 */
export function allowsAllWebsites(settings) {
  return Boolean(settings?.allow_all_websites) && settings?.assistant === 'claude-code';
}

/** Merges lists of sites, normalized and without duplicates. */
export function mergeSites(...lists) {
  return [...new Set(lists.flat().map(siteOf).filter(Boolean))];
}

/**
 * The permissions one task runs with: the allowed websites plus the sites allowed for this task
 * only. A task with its own sites also gets the web tool, so the agent can actually use them.
 */
export function withTaskSites(settings, taskSites, defaultTools) {
  const own = mergeSites(String(taskSites ?? '').split(','));
  if (own.length === 0) return settings;
  const tools = settings.allowed_tools?.length ? settings.allowed_tools : defaultTools;
  return {
    ...settings,
    shell_allowed_domains: mergeSites(settings.shell_allowed_domains ?? [], own),
    allowed_tools: [...new Set([...tools, 'web_fetch'])],
  };
}

/** Websites a tool call points to: a `url` argument, or URLs inside a shell `command`. */
export function toolCallSites(input = {}) {
  const sites = sitesIn(typeof input?.command === 'string' ? input.command : '');
  const url = siteOf(input?.url);
  return [...new Set(url ? [url, ...sites] : sites)];
}
