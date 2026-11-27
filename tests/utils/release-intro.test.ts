import { describe, expect, test } from '@jest/globals';
import { collectReleasePreamble } from '@/utils/release-markdown.js';
import { parseReleaseNotes } from '@/utils/release-notes.js';
import { buildReleaseDraft } from '@/utils/release-draft.js';
import { buildSectionFromRelease } from '@/utils/release-section.js';
import type { ReleaseChange } from '@/types/release.js';

const INTRO_BODY = [
  "We're excited to release v0.12.0! See the [guide](https://example.com/guide).",
  '',
  'This is our **biggest** release yet.',
  '',
  "## What's Changed",
  '- feat: add audience option by @alice in https://github.com/acme/tool/pull/10',
  '- fix: keep output stable by @bob in https://github.com/acme/tool/pull/11',
  '',
  '**Full Changelog**: https://github.com/acme/tool/compare/v0.11.0...v0.12.0',
].join('\n');

const EXPECTED_INTRO = [
  "We're excited to release v0.12.0! See the [guide](https://example.com/guide).",
  '',
  'This is our **biggest** release yet.',
].join('\n');

describe('collectReleasePreamble', () => {
  test('returns the lines that come before the first H2 heading', () => {
    const body = ['intro line', '', '## Added', '- one'].join('\n');

    expect(collectReleasePreamble(body)).toEqual(['intro line', '']);
  });

  test('returns nothing when the body starts with an H2 heading', () => {
    expect(collectReleasePreamble('## Added\n- one')).toEqual([]);
  });

  test('returns nothing when the body has no H2 heading at all', () => {
    expect(collectReleasePreamble('plain text\n### only H3')).toEqual([]);
  });

  test('stops at a prefixed H2 heading the section parser also recognizes', () => {
    expect(collectReleasePreamble('hello\r\n!!## Added\r\n- one')).toEqual([
      'hello',
    ]);
  });
});

describe('parseReleaseNotes intro', () => {
  test('keeps content before the first H2 as the release intro', () => {
    const parsed = parseReleaseNotes(INTRO_BODY, {
      owner: 'acme',
      repo: 'tool',
    });

    expect(parsed.intro).toBe(EXPECTED_INTRO);
  });

  test('does not turn intro paragraphs into release items', () => {
    const parsed = parseReleaseNotes(INTRO_BODY, {
      owner: 'acme',
      repo: 'tool',
    });

    expect(parsed.items.map((item) => item.pr)).toEqual([10, 11]);
    expect(parsed.items.map((item) => item.title)).toEqual([
      'add audience option',
      'keep output stable',
    ]);
  });

  test('keeps additional sections next to the intro', () => {
    const body = [
      'Intro text.',
      '',
      '## Upgrade notes',
      'Run the migration.',
    ].join('\n');

    const parsed = parseReleaseNotes(body);

    expect(parsed.intro).toBe('Intro text.');
    expect(parsed.sections).toEqual([
      { heading: 'Upgrade notes', body: 'Run the migration.' },
    ]);
  });

  test('leaves intro undefined when nothing precedes the first H2', () => {
    const parsed = parseReleaseNotes("## What's Changed\n- Add feature\n");

    expect(parsed.intro).toBeUndefined();
  });

  test('ignores the HTML comment GitHub puts at the top of generated notes', () => {
    const body = [
      '<!-- Release notes generated using configuration in .github/release.yml at main -->',
      '',
      "## What's Changed",
      '- Add feature',
    ].join('\n');

    expect(parseReleaseNotes(body).intro).toBeUndefined();
  });
});

describe('buildSectionFromRelease intro', () => {
  const changes: ReleaseChange[] = [
    {
      id: 'pr:10',
      origin: { kind: 'pull-request', number: 10 },
      title: 'add audience option',
      pr: 10,
      url: 'https://github.com/acme/tool/pull/10',
    },
  ];

  test('renders the intro between the version heading and the categories', () => {
    const section = buildSectionFromRelease({
      version: '0.12.0',
      date: '2026-11-19',
      changes,
      assignments: { 'pr:10': 'Added' },
      intro: EXPECTED_INTRO,
      sections: [{ heading: 'Upgrade notes', body: 'Run the migration.' }],
    });

    expect(section).toBe(
      [
        '## [v0.12.0] - 2026-11-19',
        '',
        EXPECTED_INTRO,
        '',
        '### Added',
        '',
        '- add audience option in [#10](https://github.com/acme/tool/pull/10)',
        '',
        '### Upgrade notes',
        '',
        'Run the migration.',
        '',
      ].join('\n'),
    );
  });

  test('renders the same section as before when there is no intro', () => {
    const base = {
      version: '0.12.0',
      date: '2026-11-19',
      changes,
      assignments: { 'pr:10': 'Added' as const },
    };

    expect(buildSectionFromRelease({ ...base, intro: undefined })).toBe(
      buildSectionFromRelease(base),
    );
    expect(buildSectionFromRelease({ ...base, intro: '  \n ' })).toBe(
      buildSectionFromRelease(base),
    );
  });

  test('demotes headings inside the intro below the category headings', () => {
    const section = buildSectionFromRelease({
      version: '1.0.0',
      date: '2026-11-19',
      changes,
      assignments: { 'pr:10': 'Added' },
      intro: '# Big release\n\nHello.',
    });

    expect(section).toContain('#### Big release\n\nHello.\n\n### Added');
    expect(section).not.toMatch(/^# Big release/m);
  });
});

describe('buildReleaseDraft intro', () => {
  test('carries the release intro into the rendered changelog section', () => {
    const draft = buildReleaseDraft({
      version: '0.12.0',
      date: '2026-11-19',
      releaseBody: INTRO_BODY,
      commitList: [],
      owner: 'acme',
      repo: 'tool',
    });

    expect(draft.intro).toBe(EXPECTED_INTRO);

    const section = buildSectionFromRelease(draft);
    const introIndex = section.indexOf("We're excited to release v0.12.0!");
    const firstCategoryIndex = section.indexOf('### ');

    expect(introIndex).toBeGreaterThan(section.indexOf('## [v0.12.0]'));
    expect(introIndex).toBeLessThan(firstCategoryIndex);
    expect(section).toContain('This is our **biggest** release yet.');
    expect(section.match(/We're excited/g)).toHaveLength(1);
  });
});

describe('release intro CRLF and whitespace preservation', () => {
  test('parses LF and CRLF release notes equivalently while preserving paragraph boundaries', () => {
    const lfBody = INTRO_BODY;
    const crlfBody = lfBody.replace(/\n/g, '\r\n');

    const lfParsed = parseReleaseNotes(lfBody, {
      owner: 'acme',
      repo: 'tool',
    });
    const crlfParsed = parseReleaseNotes(crlfBody, {
      owner: 'acme',
      repo: 'tool',
    });

    expect(lfParsed.intro).toBe(EXPECTED_INTRO);
    expect(crlfParsed.intro).toBe(EXPECTED_INTRO);
    expect(crlfParsed.intro).toBe(lfParsed.intro);
    expect(crlfParsed.intro?.split('\n\n')).toHaveLength(2);
  });

  test('normalizes leading and trailing blank lines around the intro for LF and CRLF', () => {
    const lfBody = [
      '',
      '',
      "We're excited to release v0.12.0! See the [guide](https://example.com/guide).",
      '',
      'This is our **biggest** release yet.',
      '',
      '',
      "## What's Changed",
      '- feat: add audience option by @alice in https://github.com/acme/tool/pull/10',
    ].join('\n');
    const crlfBody = lfBody.replace(/\n/g, '\r\n');

    expect(parseReleaseNotes(lfBody).intro).toBe(EXPECTED_INTRO);
    expect(parseReleaseNotes(crlfBody).intro).toBe(EXPECTED_INTRO);
  });

  test('preserves intro before categories and keeps additional sections intact across buildReleaseDraft and buildSectionFromRelease with CRLF', () => {
    const lfBody = [
      "We're excited to release v0.12.0! See the [guide](https://example.com/guide).",
      '',
      'This is our **biggest** release yet.',
      '',
      "## What's Changed",
      '- feat: add audience option by @alice in https://github.com/acme/tool/pull/10',
      '',
      '## Upgrade notes',
      'Run the migration.',
      '',
      'Verify config.',
    ].join('\n');
    const crlfBody = lfBody.replace(/\n/g, '\r\n');

    const lfDraft = buildReleaseDraft({
      version: '0.12.0',
      date: '2026-11-19',
      releaseBody: lfBody,
      commitList: [],
      owner: 'acme',
      repo: 'tool',
    });
    const crlfDraft = buildReleaseDraft({
      version: '0.12.0',
      date: '2026-11-19',
      releaseBody: crlfBody,
      commitList: [],
      owner: 'acme',
      repo: 'tool',
    });

    const lfSection = buildSectionFromRelease(lfDraft);
    const crlfSection = buildSectionFromRelease(crlfDraft);

    expect(crlfSection).toBe(lfSection);
    expect(crlfSection.indexOf(EXPECTED_INTRO)).toBeGreaterThan(
      crlfSection.indexOf('## [v0.12.0] - 2026-11-19'),
    );
    expect(crlfSection.indexOf(EXPECTED_INTRO)).toBeLessThan(
      crlfSection.indexOf('### Added'),
    );
    expect(crlfSection).toContain(
      '### Upgrade notes\n\nRun the migration.\n\nVerify config.',
    );
  });

  test('does not alter generated output when intro is absent in CRLF input', () => {
    const lfBody = [
      "## What's Changed",
      '- feat: add audience option by @alice in https://github.com/acme/tool/pull/10',
    ].join('\n');
    const crlfBody = lfBody.replace(/\n/g, '\r\n');

    const lfDraft = buildReleaseDraft({
      version: '0.12.0',
      date: '2026-11-19',
      releaseBody: lfBody,
      commitList: [],
      owner: 'acme',
      repo: 'tool',
    });
    const crlfDraft = buildReleaseDraft({
      version: '0.12.0',
      date: '2026-11-19',
      releaseBody: crlfBody,
      commitList: [],
      owner: 'acme',
      repo: 'tool',
    });

    expect(crlfDraft.intro).toBeUndefined();
    expect(buildSectionFromRelease(crlfDraft)).toBe(
      buildSectionFromRelease(lfDraft),
    );
  });
});
