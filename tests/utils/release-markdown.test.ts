import { test, expect, describe } from '@jest/globals';
import {
  collectReleaseH2Sections,
  collectReleasePreamble,
  demoteAdditionalSectionHeadings,
} from '@/utils/release-markdown.js';

describe('collectReleaseH2Sections', () => {
  test('preserves H2 sections in source order', () => {
    const body = ['## Added', '- one', '## Fixed', '- two', '## Docs', '- three'].join('\n');

    const sections = collectReleaseH2Sections(body);

    expect(sections.map((section) => section.heading)).toEqual(['Added', 'Fixed', 'Docs']);
  });

  test('keeps nested H3+ content inside the current H2 section', () => {
    const body = ['## Added', '- one', '### Details', 'more detail', '## Fixed', '- two'].join('\n');

    const sections = collectReleaseH2Sections(body);

    expect(sections).toHaveLength(2);
    expect(sections[0]?.lines).toEqual(['- one', '### Details', 'more detail']);
    expect(sections[1]?.lines).toEqual(['- two']);
  });

  test('ignores content before the first H2 section', () => {
    const body = ['preamble text', '# Title', '', '## Added', '- one'].join('\n');

    const sections = collectReleaseH2Sections(body);

    expect(sections).toHaveLength(1);
    expect(sections[0]?.heading).toBe('Added');
    expect(sections[0]?.lines).toEqual(['- one']);
  });

  test('normalizes prefixed heading lines before splitting sections', () => {
    const body = ['!!## Added', '- one', '## Fixed', '- two'].join('\n');

    const sections = collectReleaseH2Sections(body);

    expect(sections.map((section) => section.heading)).toEqual(['Added', 'Fixed']);
  });

  test('splits CRLF bodies the same way as LF bodies', () => {
    const body = '## Added\r\n- one\r\n## Fixed\r\n- two';

    const sections = collectReleaseH2Sections(body);

    expect(sections.map((section) => section.heading)).toEqual(['Added', 'Fixed']);
    expect(sections[0]?.lines).toEqual(['- one']);
  });

  test('returns no sections when the body has no H2 heading', () => {
    expect(collectReleaseH2Sections('plain text\n### only H3')).toEqual([]);
  });
});

describe('demoteAdditionalSectionHeadings', () => {
  test('demotes nested headings to H4 or deeper', () => {
    const body = ['# Top', '## Section', '### Sub', '#### Deep'].join('\n');

    const out = demoteAdditionalSectionHeadings(body);

    expect(out).toBe(['#### Top', '#### Section', '#### Sub', '##### Deep'].join('\n'));
  });

  test('never produces headings deeper than H6', () => {
    const body = ['##### Five', '###### Six'].join('\n');

    const out = demoteAdditionalSectionHeadings(body);

    expect(out).toBe(['###### Five', '###### Six'].join('\n'));
  });

  test('does not modify headings inside fenced code blocks', () => {
    const body = ['## Real', '```', '# not a heading', '## also not', '```', '## After'].join('\n');

    const out = demoteAdditionalSectionHeadings(body);

    expect(out).toBe(['#### Real', '```', '# not a heading', '## also not', '```', '#### After'].join('\n'));
  });

  test('supports tilde fences', () => {
    const body = ['~~~', '# fenced', '~~~', '# outside'].join('\n');

    const out = demoteAdditionalSectionHeadings(body);

    expect(out).toBe(['~~~', '# fenced', '~~~', '#### outside'].join('\n'));
  });

  test('a fence only closes on its own marker', () => {
    const body = ['```', '~~~', '# still fenced', '```', '# outside'].join('\n');

    const out = demoteAdditionalSectionHeadings(body);

    expect(out).toBe(['```', '~~~', '# still fenced', '```', '#### outside'].join('\n'));
  });

  test('normalizes prefixed heading lines before demoting', () => {
    const out = demoteAdditionalSectionHeadings('!!## Section');

    expect(out).toBe('#### Section');
  });

  test('leaves lines without heading whitespace untouched', () => {
    expect(demoteAdditionalSectionHeadings('##NoSpace')).toBe('##NoSpace');
  });
});

describe('collectReleaseH2Sections with fenced code blocks', () => {
  test('keeps H2-like lines inside a backtick fence in the current section', () => {
    const body = [
      "## What's Changed",
      '',
      'Here is an example:',
      '',
      '```markdown',
      '## Example',
      '- This is not a release section',
      '```',
      '',
      '- fix: resolve an issue',
    ].join('\n');

    const sections = collectReleaseH2Sections(body);

    expect(sections.map((section) => section.heading)).toEqual([
      "What's Changed",
    ]);
    expect(sections[0]?.lines).toEqual(body.split('\n').slice(1));
  });

  test('keeps H2-like lines inside a tilde fence in the current section', () => {
    const body = ['## Added', '~~~md', '## Example', '~~~', '- one'].join('\n');

    const sections = collectReleaseH2Sections(body);

    expect(sections.map((section) => section.heading)).toEqual(['Added']);
    expect(sections[0]?.lines).toEqual(['~~~md', '## Example', '~~~', '- one']);
  });

  test('splits the sections around an embedded fence in their original order', () => {
    const body = [
      '## Added',
      '- one',
      '```',
      '## not a section',
      '```',
      '## Fixed',
      '- two',
      '~~~',
      '## also not a section',
      '~~~',
      '## Docs',
      '- three',
    ].join('\n');

    const sections = collectReleaseH2Sections(body);

    expect(sections).toEqual([
      { heading: 'Added', lines: ['- one', '```', '## not a section', '```'] },
      {
        heading: 'Fixed',
        lines: ['- two', '~~~', '## also not a section', '~~~'],
      },
      { heading: 'Docs', lines: ['- three'] },
    ]);
  });

  test('keeps fenced lines verbatim instead of normalizing them', () => {
    const body = ['## Added', '```', '!!## prefixed example', '```'].join('\n');

    const sections = collectReleaseH2Sections(body);

    expect(sections[0]?.lines).toEqual(['```', '!!## prefixed example', '```']);
  });

  test('a shorter or different delimiter does not close a longer fence', () => {
    const body = [
      '## Added',
      '````markdown',
      '```ts',
      '~~~',
      '## still fenced',
      '```',
      '````',
      '## After',
      '- two',
    ].join('\n');

    const sections = collectReleaseH2Sections(body);

    expect(sections.map((section) => section.heading)).toEqual([
      'Added',
      'After',
    ]);
    expect(sections[1]?.lines).toEqual(['- two']);
  });

  test('an unclosed fence runs to the end of the body, as in CommonMark', () => {
    const body = ['## Added', '```', '## inside the open fence'].join('\n');

    const sections = collectReleaseH2Sections(body);

    expect(sections.map((section) => section.heading)).toEqual(['Added']);
    expect(sections[0]?.lines).toEqual(['```', '## inside the open fence']);
  });
});

describe('collectReleaseH2Sections fence rules shared with attach-pr', () => {
  test('a delimiter indented four spaces does not open a fence', () => {
    const body = ['## Added', '    ```', '## Fixed', '- two'].join('\n');

    const sections = collectReleaseH2Sections(body);

    expect(sections.map((section) => section.heading)).toEqual([
      'Added',
      'Fixed',
    ]);
  });

  test('a backtick run with a backtick in its info string does not open a fence', () => {
    const body = ['## Added', '```a`b', '## Fixed', '- two'].join('\n');

    const sections = collectReleaseH2Sections(body);

    expect(sections.map((section) => section.heading)).toEqual([
      'Added',
      'Fixed',
    ]);
  });

  test('a closing fence may carry trailing spaces but no info string', () => {
    const body = [
      '## Added',
      '```',
      '```ts',
      '## still fenced',
      '```  ',
      '## Fixed',
    ].join('\n');

    const sections = collectReleaseH2Sections(body);

    expect(sections.map((section) => section.heading)).toEqual([
      'Added',
      'Fixed',
    ]);
  });
});

describe('collectReleasePreamble with fenced code blocks', () => {
  test('does not end the preamble at an H2-like line inside a fence', () => {
    const body = [
      'Intro text',
      '```',
      '## Example',
      '```',
      '## Added',
      '- one',
    ].join('\n');

    expect(collectReleasePreamble(body)).toEqual([
      'Intro text',
      '```',
      '## Example',
      '```',
    ]);
  });
});
