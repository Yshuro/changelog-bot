import { describe, expect, test } from '@jest/globals';
import type { CategoryAssignments } from '@/types/changelog.js';
import type { ReleaseChange } from '@/types/release.js';
import {
  applyDeterministicClassification,
  classifyChangesDeterministically,
  classifyTitleDeterministically,
} from '@/utils/deterministic-classification.js';

function releaseNoteChange(
  index: number,
  title: string,
  rawTitle?: string,
): ReleaseChange {
  return {
    id: `release-note:${index}`,
    origin: { kind: 'release-note', index },
    title,
    rawTitle,
  };
}

describe('deterministic classification', () => {
  test.each([
    'feat!: replace the output contract',
    'feat(core)!: replace the output contract',
    'fix!: remove legacy parsing',
    'fix(api)!: remove legacy parsing',
    'security!: patch an authentication bypass',
    'deps(runtime)!: require a newer runtime',
  ])('prioritizes the breaking marker in %s', (title) => {
    expect(classifyTitleDeterministically(title)).toEqual({
      category: 'Breaking Changes',
      signal: 'breaking',
    });
  });

  test.each([
    ['feat: add x', true],
    ['fix: handle y', true],
    ['chore: update tool', true],
  ])('prioritizes breaking flag in %s with breaking=%s', (title, breaking) => {
    expect(classifyTitleDeterministically(title, breaking)).toEqual({
      category: 'Breaking Changes',
      signal: 'breaking',
    });
  });

  test.each([
    'Revert "feat: add legacy flag"',
    'Revert "fix: handle parser bug"',
    "Revert 'feat: add something'",
    'Revert "feat: add feature" (#42)',
    'revert: restore legacy output',
    'revert(core): rollback breaking API',
  ])('classifies git revert subjects in %s under Reverted', (title) => {
    expect(classifyTitleDeterministically(title)).toEqual({
      category: 'Reverted',
      signal: 'conventional',
    });
  });

  test.each([
    ['feat: add export support', 'Added'],
    ['fix(parser): prevent a crash', 'Fixed'],
    ['refactor: simplify parsing', 'Changed'],
    ['perf: reduce allocations', 'Changed'],
    ['style: format generated output', 'Changed'],
    ['docs: update the guide', 'Docs'],
    ['test: cover duplicate titles', 'Test'],
    ['build: update packaging', 'Chore'],
    ['ci: update the release workflow', 'Chore'],
    ['chore: update dependencies', 'Chore'],
    ['revert: restore legacy output', 'Reverted'],
  ])('maps conventional title %s to %s', (title, category) => {
    expect(classifyTitleDeterministically(title)).toEqual({
      category,
      signal: 'conventional',
    });
  });

  test('keeps a conventional type above conflicting semantic intent', () => {
    expect(
      classifyTitleDeterministically('chore: tighten option type'),
    ).toEqual({
      category: 'Chore',
      signal: 'conventional',
    });
  });

  test.each([
    ['tighten option type to prevent misuse', 'Fixed'],
    ['improve classification consistency', 'Changed'],
    ['Update dependency prettier to v3.8.0', 'Chore'],
  ])('applies strong semantic classification for %s', (title, category) => {
    expect(classifyTitleDeterministically(title)).toEqual({
      category,
      signal: 'strong-semantic',
    });
  });

  test.each([
    'added a little helper function to avoid deduplication in metadata di…',
    'added a helper function to avoid deduplication in metadata diagnostics',
    'add helper function to avoid deduplication in metadata diagnostics',
    'add helper to reduce duplication in diagnostic formatting',
    'add internal helper to format errors',
    'add shared helper function for fallback reasons',
    'introduce internal helper for diagnostics',
    'extract shared fallback reason formatting in dry-run diagnostics',
    'extract helper function for metadata diagnostics',
    'extract internal helper to parse release tags',
    'reuse pull request lookup logic for commits',
    'reuse version section matching logic in changelog utilities',
    'reduce duplicated GitHub metadata error formatting',
    'deduplicate pull request lookup logic',
  ])(
    'classifies internal helper extraction or code reuse in "%s" as Changed',
    (title) => {
      expect(classifyTitleDeterministically(title)).toEqual({
        category: 'Changed',
        signal: 'strong-semantic',
      });
    },
  );

  test.each([
    'add support for custom models',
    'add markdown export feature',
    'introduce audience option',
    'add helper command for CLI',
    'add helper option to export command',
    'add deduplication feature',
    'add deduplication support for changelog entries',
    'introduce deduplication option',
    'add code duplication detection',
    'add a code duplication report to the CLI',
  ])(
    'preserves Added classification for legitimate new feature "%s"',
    (title) => {
      expect(classifyTitleDeterministically(title).category).toBe('Added');
    },
  );

  test.each([
    ['extract function signatures into the API docs', 'Docs'],
    ['extract release notes logic from commit bodies', 'Chore'],
  ])(
    'preserves classification for non-refactoring extraction title "%s" as %s',
    (title, expectedCategory) => {
      expect(classifyTitleDeterministically(title).category).toBe(
        expectedCategory,
      );
    },
  );

  test('preserves explicit conventional commit precedence over internal helper semantics', () => {
    expect(
      classifyTitleDeterministically(
        'feat: added a little helper function to avoid deduplication in metadata di…',
      ),
    ).toEqual({
      category: 'Added',
      signal: 'conventional',
    });
    expect(
      classifyTitleDeterministically(
        'refactor: deduplicate auth token validation helpers',
      ),
    ).toEqual({
      category: 'Changed',
      signal: 'conventional',
    });
    expect(
      classifyTitleDeterministically(
        'feat: deduplicate auth token validation helpers',
      ),
    ).toEqual({
      category: 'Added',
      signal: 'conventional',
    });
  });

  test.each([
    'Release: 0.9.0',
    'release: v0.9.0',
    'chore(release): 0.9.0',
    'publish 0.9.0',
  ])('classifies release automation %s as Chore', (title) => {
    expect(classifyTitleDeterministically(title)).toEqual({
      category: 'Chore',
      signal: 'strong-semantic',
    });
  });

  test('uses weak score signals before the Chore fallback', () => {
    expect(classifyTitleDeterministically('patch parser handling')).toEqual({
      category: 'Fixed',
      signal: 'weak-semantic',
    });
    expect(classifyTitleDeterministically('miscellaneous work')).toEqual({
      category: 'Chore',
      signal: 'fallback',
    });
  });

  test('produces complete no-provider assignments', () => {
    expect(
      classifyChangesDeterministically([
        { id: 'release-note:0', title: 'feat!: replace output' },
        { id: 'release-note:1', title: 'fix: prevent crash' },
      ]),
    ).toEqual({
      'release-note:0': 'Breaking Changes',
      'release-note:1': 'Fixed',
    });
  });

  test('overrides provider output with higher-precedence source signals', () => {
    const changes = [
      releaseNoteChange(0, 'Replace output', 'feat(core)!: replace output'),
      releaseNoteChange(1, 'Prevent crash', 'fix: prevent crash'),
      releaseNoteChange(2, 'Tighten option type'),
    ];
    const providerAssignments: CategoryAssignments = {
      'release-note:0': 'Added',
      'release-note:1': 'Added',
      'release-note:2': 'Added',
    };

    expect(
      applyDeterministicClassification(changes, providerAssignments),
    ).toEqual({
      'release-note:0': 'Breaking Changes',
      'release-note:1': 'Fixed',
      'release-note:2': 'Fixed',
    });
  });

  test('uses weak semantics only to replace weak provider categories', () => {
    const changes = [
      releaseNoteChange(0, 'patch parser handling'),
      releaseNoteChange(1, 'patch renderer handling'),
    ];

    expect(
      applyDeterministicClassification(changes, {
        'release-note:0': 'Added',
        'release-note:1': 'Chore',
      }),
    ).toEqual({
      'release-note:0': 'Added',
      'release-note:1': 'Fixed',
    });
  });

  test('prevents provider output from promoting release automation', () => {
    const changes = [releaseNoteChange(0, 'Release: 0.9.0')];

    expect(
      applyDeterministicClassification(changes, {
        'release-note:0': 'Added',
      }),
    ).toEqual({
      'release-note:0': 'Chore',
    });
  });

  test('overrides provider output when release item declares breaking change or git revert', () => {
    const changes: ReleaseChange[] = [
      {
        ...releaseNoteChange(0, 'add x', 'feat: add x'),
        breaking: true,
      },
      {
        ...releaseNoteChange(1, 'handle y', 'fix: handle y'),
        breaking: true,
      },
      releaseNoteChange(
        2,
        'Revert "feat: add legacy flag"',
        'Revert "feat: add legacy flag"',
      ),
    ];
    const providerAssignments: CategoryAssignments = {
      'release-note:0': 'Added',
      'release-note:1': 'Fixed',
      'release-note:2': 'Added',
    };

    expect(
      applyDeterministicClassification(changes, providerAssignments),
    ).toEqual({
      'release-note:0': 'Breaking Changes',
      'release-note:1': 'Breaking Changes',
      'release-note:2': 'Reverted',
    });
  });

  test('overrides provider Added assignment for internal helper extraction (#325 regression)', () => {
    const changes = [
      releaseNoteChange(
        325,
        'added a little helper function to avoid deduplication in metadata di…',
      ),
    ];
    const providerAssignments: CategoryAssignments = {
      'release-note:325': 'Added',
    };

    expect(
      applyDeterministicClassification(changes, providerAssignments),
    ).toEqual({
      'release-note:325': 'Changed',
    });
  });

  test.each([
    'add deduplication support for release notes',
    'support deduplication of release tags',
    'add option to deduplicate changelog entries',
    'add code duplication detection',
    'add a code duplication report to the CLI',
  ])(
    'preserves provider Added assignment for legitimate deduplication feature "%s"',
    (title) => {
      const changes = [releaseNoteChange(100, title)];
      const providerAssignments: CategoryAssignments = {
        'release-note:100': 'Added',
      };

      expect(
        applyDeterministicClassification(changes, providerAssignments),
      ).toEqual({
        'release-note:100': 'Added',
      });
    },
  );
});
