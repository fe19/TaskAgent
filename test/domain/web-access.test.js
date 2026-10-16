import { test } from 'node:test';
import assert from 'node:assert/strict';
import { allowsAllWebsites, isSiteAllowed, mergeSites, siteOf, sitesIn, sitesNotAllowed, toolCallSites, withTaskSites } from '../../src/domain/web-access.js';

test('a site is the host: every page under it is covered', () => {
  assert.equal(siteOf('https://WWW.BBC.co.uk/news?x=1#top'), 'www.bbc.co.uk');
  assert.equal(siteOf('www.bbc.co.uk/news'), 'www.bbc.co.uk');
  assert.equal(siteOf('example.com:8080'), 'example.com');
  assert.equal(siteOf('*.example.com'), '*.example.com');
  assert.equal(siteOf('not a site'), null);
  assert.equal(siteOf(''), null);
});

test('sites are found in URLs, www. names and names with a path', () => {
  assert.deepEqual(
    sitesIn('Summarise https://www.bbc.co.uk/news and www.theguardian.com, compare with reuters.com/world.'),
    ['www.bbc.co.uk', 'www.theguardian.com', 'reuters.com'],
  );
});

test('file names and bare names in prose are not websites', () => {
  assert.deepEqual(sitesIn('Update README.md and src/app.js, then read notes.md and package.json'), []);
  assert.deepEqual(sitesIn('We use example.com in our docs.'), []);
});

test('the same site is listed once', () => {
  assert.deepEqual(sitesIn('https://bbc.co.uk/a and https://bbc.co.uk/b'), ['bbc.co.uk']);
});

test('allowed sites match exactly; *. entries cover subdomains', () => {
  assert.equal(isSiteAllowed('www.bbc.co.uk', ['www.bbc.co.uk']), true);
  assert.equal(isSiteAllowed('https://www.bbc.co.uk/news', ['www.bbc.co.uk/']), true, 'root covers all pages');
  assert.equal(isSiteAllowed('bbc.co.uk', ['www.bbc.co.uk']), false);
  assert.equal(isSiteAllowed('news.bbc.co.uk', ['*.bbc.co.uk']), true);
  assert.equal(isSiteAllowed('bbc.co.uk', ['*.bbc.co.uk']), true);
  assert.equal(isSiteAllowed('evilbbc.co.uk', ['*.bbc.co.uk']), false);
});

test('the sites a prompt needs are those no list allows', () => {
  const prompt = 'Compare https://www.bbc.co.uk/news with https://www.reuters.com/world';
  assert.deepEqual(sitesNotAllowed(prompt, ['www.bbc.co.uk'], []), ['www.reuters.com']);
  assert.deepEqual(sitesNotAllowed(prompt, ['www.bbc.co.uk'], ['www.reuters.com']), []);
});

test('lists merge normalized and without duplicates', () => {
  assert.deepEqual(mergeSites(['https://a.com/x', 'b.org'], ['A.com', 'junk!']), ['a.com', 'b.org']);
});

test('a task with its own sites gets them on top of the allowed websites, plus the web tool', () => {
  const settings = { allowed_tools: ['view', 'bash'], shell_allowed_domains: ['pypi.org'] };
  const run = withTaskSites(settings, 'www.bbc.co.uk', ['view']);
  assert.deepEqual(run.shell_allowed_domains, ['pypi.org', 'www.bbc.co.uk']);
  assert.deepEqual(run.allowed_tools, ['view', 'bash', 'web_fetch']);
  assert.equal(withTaskSites(settings, '', ['view']), settings, 'unchanged without own sites');
  assert.deepEqual(withTaskSites({ allowed_tools: [], shell_allowed_domains: [] }, 'a.com', ['view', 'edit']).allowed_tools, ['view', 'edit', 'web_fetch'], 'defaults kept');
});

test('"allow all websites" applies to Claude Code only; Copilot\'s sandbox cannot express it', () => {
  assert.equal(allowsAllWebsites({ allow_all_websites: true, assistant: 'claude-code' }), true);
  assert.equal(allowsAllWebsites({ allow_all_websites: true, assistant: 'copilot' }), false);
  assert.equal(allowsAllWebsites({ allow_all_websites: false, assistant: 'claude-code' }), false);
});

test('a tool call targets its url, or the URLs in its command', () => {
  assert.deepEqual(toolCallSites({ url: 'https://www.bbc.co.uk/news' }), ['www.bbc.co.uk']);
  assert.deepEqual(toolCallSites({ command: 'curl -s https://pypi.org/simple && wget https://x.org/a' }), ['pypi.org', 'x.org']);
  assert.deepEqual(toolCallSites({ command: 'ls -la' }), []);
  assert.deepEqual(toolCallSites(undefined), []);
});
