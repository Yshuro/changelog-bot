import {
  SECTION_ADDED,
  SECTION_BREAKING_CHANGES,
  SECTION_CHANGED,
  SECTION_CHORE,
  SECTION_DOCS,
  SECTION_FIXED,
  SECTION_ORDER,
  SECTION_REVERTED,
  SECTION_TEST,
} from '@/constants/changelog.js';
import {
  COMMIT_TYPES,
  CONVENTIONAL_BREAKING_PREFIX_RE,
  CONVENTIONAL_PREFIX_RE,
  REFACTOR_LIKE_RE,
} from '@/constants/conventional.js';
import type {
  BucketName,
  CategoryAssignments,
  CategoryScores,
  ClassificationChange,
  ClassificationSignal,
  DeterministicClassification,
} from '@/types/changelog.js';
import type { ReleaseChange } from '@/types/release.js';
import { bestCategory, scoreCategories } from '@/utils/category-score.js';
import { isDependencyUpdateTitle } from '@/utils/dependency-update.js';
import { isRevertTitle } from '@/utils/conventional.js';

type CommitType = (typeof COMMIT_TYPES)[number];

const COMMIT_TYPE_CATEGORIES: Record<CommitType, BucketName> = {
  feat: SECTION_ADDED,
  fix: SECTION_FIXED,
  refactor: SECTION_CHANGED,
  perf: SECTION_CHANGED,
  style: SECTION_CHANGED,
  docs: SECTION_DOCS,
  build: SECTION_CHORE,
  ci: SECTION_CHORE,
  test: SECTION_TEST,
  chore: SECTION_CHORE,
  revert: SECTION_REVERTED,
};

const TYPE_INTENT_INDICATORS = [
  'type',
  'types',
  'typing',
  'type definition',
  'type definitions',
  'typedef',
  'd.ts',
  'ts type',
  'option type',
];

const FIX_INTENT_INDICATORS = [
  'fix',
  'correct',
  'tighten',
  'narrow',
  'wrong',
  'invalid',
  'incorrect',
  'mismatch',
  'bug',
  'error',
];

const CHANGE_LIKE_INDICATORS = [
  'improve',
  'improvement',
  'enhance',
  'enhancement',
  'optimize',
  'optimization',
  'refine',
  'refinement',
  'streamline',
  'simplify',
  'polish',
  'rework',
  'revise',
  'revamp',
  'stabilize',
  'hardening',
  'harden',
  'tweak',
  'adjust',
  'tune',
  'tuning',
  'retune',
  'fine-tune',
  'fine tune',
  'finetune',
];

// WHY: Only version-only release and publish titles identify automation. Anchoring
// the pattern avoids reclassifying product changes such as "fix release lookup".
const RELEASE_AUTOMATION_TITLE_RE =
  /^(?:(?:release|publish)\s*:?\s+|chore\(release\):\s*)v?\d+\.\d+\.\d+(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/i;

const SIGNAL_PRIORITY: Record<ClassificationSignal, number> = {
  breaking: 5,
  conventional: 4,
  'strong-semantic': 3,
  'weak-semantic': 2,
  fallback: 1,
};

const WEAK_PROVIDER_CATEGORIES = new Set<BucketName>([
  SECTION_CHORE,
  SECTION_DOCS,
  SECTION_TEST,
]);

function semanticTitleCore(rawTitle: string): string {
  return rawTitle.toLowerCase().replace(CONVENTIONAL_PREFIX_RE, '').trim();
}

// Patterns identifying internal helper additions, logic extraction, and deduplication/reuse.
// WHY: Issue #373: Titles describing internal helper creation, utility extraction, or
// code deduplication (e.g. PR #325) represent refactoring and belong under Changed,
// not Added, unless explicitly marked as a new feature via Conventional Commits (feat:).
const ADD_INTERNAL_HELPER_RE =
  /\b(?:add(?:ed|ing)?|introduc(?:e|ed|ing)|creat(?:e|ed|ing))\s+(?:(?:a|an|the)\s+)?(?:(?:little|internal|shared|private|reusable|common)\s+)+(?:helper|utility|util|function|method)s?\b/i;

const ADD_HELPER_FUNCTION_RE =
  /\b(?:add(?:ed|ing)?|introduc(?:e|ed|ing)|creat(?:e|ed|ing))\s+(?:(?:a|an|the)\s+)?(?:helper|utility|util)\s+(?:function|method)s?\b/i;

const ADD_HELPER_TO_DEDUPLICATE_OR_REUSE_RE =
  /\b(?:add(?:ed|ing)?|introduc(?:e|ed|ing)|creat(?:e|ed|ing))\b.*?\b(?:helper|utility|util|function|method)s?\b.*?\b(?:to|for|in order to)\b.*?\b(?:avoid|reduc(?:e|ed|ing)|remov(?:e|ed|ing)|eliminat(?:e|ed|ing)|prevent(?:ing)?)\b.*?\b(?:(?:code|logic)\s+)?(?:de)?duplication\b/i;

const ADD_HELPER_FOR_REUSE_RE =
  /\b(?:add(?:ed|ing)?|introduc(?:e|ed|ing)|creat(?:e|ed|ing))\b.*?\b(?:helper|utility|util|function|method)s?\b.*?\b(?:to|for)\b.*?\b(?:(?:code|logic)\s+)?reuse\b/i;

const EXTRACT_HELPER_OR_LOGIC_RE =
  /\bextract(?:s|ed|ing|ion)?\s+(?:(?:a|an|the)\s+)?(?:shared|reusable|internal|private|common)\b/i;

const EXTRACT_FUNCTION_OR_LOGIC_RE =
  /\bextract(?:s|ed|ing|ion)?\s+(?:(?:a|an|the)\s+)?(?:(?:shared|internal|helper|utility|util|common|private)\s+)?(?:helper|function|utility|util|method|logic|predicate|guard)s?\b(?!\s+signatures?\b)/i;

const REUSE_LOGIC_RE =
  /\b(?:reus(?:e|ed|ing|able)|code\s+reuse)\b.*?\b(?:logic|helper|function|utility|util|method|predicate|guard|implementation)s?\b/i;

const INTERNAL_OR_REUSE_CONTEXT =
  '(?:helpers?|utilities|utility|utils?|functions?|methods?|logics?|code|implementations?|routines?|predicates?|guards?|diagnostics?|formatting|internal|private|shared|reusable|reuse)';

const REDUCE_DUPLICATION_RE = new RegExp(
  `\\b(?:reduc(?:e|ed|ing)|avoid(?:s|ed|ing)?|remov(?:e|ed|ing)|eliminat(?:e|ed|ing)|prevent(?:s|ed|ing)?)\\b.*?\\b(?:duplicated?|(?:code|logic)\\s+duplication|(?:de)?duplication)\\b.*?\\b${INTERNAL_OR_REUSE_CONTEXT}\\b|` +
    `\\b${INTERNAL_OR_REUSE_CONTEXT}\\b.*?\\b(?:reduc(?:e|ed|ing)|avoid(?:s|ed|ing)?|remov(?:e|ed|ing)|eliminat(?:e|ed|ing)|prevent(?:s|ed|ing)?)\\b.*?\\b(?:duplicated?|(?:code|logic)\\s+duplication|(?:de)?duplication)\\b|` +
    `\\b(?:reduc(?:e|ed|ing)|avoid(?:s|ed|ing)?|remov(?:e|ed|ing)|eliminat(?:e|ed|ing)|prevent(?:s|ed|ing)?)\\b.*?\\b(?:code|logic)\\s+(?:de)?duplication\\b`,
  'i',
);

const DEDUPLICATION_INTENT_RE = new RegExp(
  `\\b(?:deduplicat(?:e|ed|ing|ion))\\b.*?\\b${INTERNAL_OR_REUSE_CONTEXT}\\b|` +
    `\\b${INTERNAL_OR_REUSE_CONTEXT}\\b.*?\\b(?:deduplicat(?:e|ed|ing|ion))\\b`,
  'i',
);

function isInternalHelperOrReuseTitle(rawTitle: string): boolean {
  const core = semanticTitleCore(rawTitle);
  if (/^(?:fix(?:es|ed|ing)?|patch(?:es|ed|ing)?)\b/i.test(core)) {
    return false;
  }
  return (
    ADD_INTERNAL_HELPER_RE.test(core) ||
    ADD_HELPER_FUNCTION_RE.test(core) ||
    ADD_HELPER_TO_DEDUPLICATE_OR_REUSE_RE.test(core) ||
    ADD_HELPER_FOR_REUSE_RE.test(core) ||
    EXTRACT_HELPER_OR_LOGIC_RE.test(core) ||
    EXTRACT_FUNCTION_OR_LOGIC_RE.test(core) ||
    REUSE_LOGIC_RE.test(core) ||
    REDUCE_DUPLICATION_RE.test(core) ||
    DEDUPLICATION_INTENT_RE.test(core)
  );
}

function isImplicitFixTitle(rawTitle: string): boolean {
  const core = semanticTitleCore(rawTitle);
  const mentionsType = TYPE_INTENT_INDICATORS.some((keyword) =>
    core.includes(keyword),
  );
  const impliesFix = FIX_INTENT_INDICATORS.some((keyword) =>
    core.includes(keyword),
  );
  return (
    (mentionsType && impliesFix) ||
    (mentionsType && (core.includes('narrow') || core.includes('tighten')))
  );
}

function isChangeLikeTitle(rawTitle: string): boolean {
  const core = semanticTitleCore(rawTitle);
  return (
    REFACTOR_LIKE_RE.test(rawTitle) ||
    CHANGE_LIKE_INDICATORS.some((keyword) => core.includes(keyword))
  );
}

function isReleaseAutomationTitle(rawTitle: string): boolean {
  return RELEASE_AUTOMATION_TITLE_RE.test(rawTitle.trim());
}

function conventionalCategory(rawTitle: string): BucketName | undefined {
  const match = CONVENTIONAL_PREFIX_RE.exec(rawTitle);
  if (!match?.[1]) return undefined;
  return COMMIT_TYPE_CATEGORIES[match[1].toLowerCase() as CommitType];
}

function highestScoringCategory(scores: CategoryScores): BucketName | null {
  let topCategory: BucketName | null = null;
  let topScore = 0;
  let secondScore = 0;

  for (const category of SECTION_ORDER) {
    const score = scores[category];
    if (score > topScore) {
      secondScore = topScore;
      topScore = score;
      topCategory = category;
    } else if (score > secondScore) {
      secondScore = score;
    }
  }

  return topCategory && topScore > secondScore ? topCategory : null;
}

/**
 * Classify one title using the canonical deterministic precedence.
 * @param rawTitle Original title or commit subject, including any prefix.
 * @param breaking Optional explicit breaking change signal.
 * @returns Category and the signal strength responsible for the decision.
 */
export function classifyTitleDeterministically(
  rawTitle: string,
  breaking?: boolean,
): DeterministicClassification {
  if (breaking || CONVENTIONAL_BREAKING_PREFIX_RE.test(rawTitle)) {
    return { category: SECTION_BREAKING_CHANGES, signal: 'breaking' };
  }

  if (isReleaseAutomationTitle(rawTitle)) {
    return { category: SECTION_CHORE, signal: 'strong-semantic' };
  }

  if (isRevertTitle(rawTitle)) {
    return { category: SECTION_REVERTED, signal: 'conventional' };
  }

  const prefixCategory = conventionalCategory(rawTitle);
  if (prefixCategory) {
    return { category: prefixCategory, signal: 'conventional' };
  }

  if (isDependencyUpdateTitle(rawTitle)) {
    return { category: SECTION_CHORE, signal: 'strong-semantic' };
  }
  if (isImplicitFixTitle(rawTitle)) {
    return { category: SECTION_FIXED, signal: 'strong-semantic' };
  }
  if (isInternalHelperOrReuseTitle(rawTitle)) {
    return { category: SECTION_CHANGED, signal: 'strong-semantic' };
  }

  const scores = scoreCategories(rawTitle);
  const strongCategory = bestCategory(scores);
  if (strongCategory) {
    return { category: strongCategory, signal: 'strong-semantic' };
  }
  if (isChangeLikeTitle(rawTitle)) {
    return { category: SECTION_CHANGED, signal: 'strong-semantic' };
  }

  const weakCategory = highestScoringCategory(scores);
  if (weakCategory) {
    return { category: weakCategory, signal: 'weak-semantic' };
  }

  return { category: SECTION_CHORE, signal: 'fallback' };
}

/**
 * Classify normalized provider inputs without calling a provider.
 * @param changes Stable IDs and titles to classify.
 * @returns Complete deterministic assignments keyed by change ID.
 */
export function classifyChangesDeterministically(
  changes: readonly ClassificationChange[],
): CategoryAssignments {
  return Object.fromEntries(
    changes.map(({ id, title, breaking }) => [
      id,
      classifyTitleDeterministically(title, breaking).category,
    ]),
  ) as CategoryAssignments;
}

function changeTitles(
  change: ReleaseChange,
  classificationTitle?: string,
): string[] {
  return Array.from(
    new Set(
      [change.rawTitle, change.title, classificationTitle].filter(
        (title): title is string => Boolean(title),
      ),
    ),
  );
}

function strongestClassification(
  titles: string[],
  breaking?: boolean,
): DeterministicClassification {
  let strongest: DeterministicClassification = {
    category: SECTION_CHORE,
    signal: 'fallback',
  };
  for (const title of titles) {
    const candidate = classifyTitleDeterministically(title, breaking);
    if (SIGNAL_PRIORITY[candidate.signal] > SIGNAL_PRIORITY[strongest.signal]) {
      strongest = candidate;
    }
  }
  return strongest;
}

function categoryAfterDeterministicRules(
  currentCategory: BucketName,
  decision: DeterministicClassification,
): BucketName {
  const shouldOverride =
    decision.signal === 'breaking' ||
    decision.signal === 'conventional' ||
    decision.signal === 'strong-semantic' ||
    (decision.signal === 'weak-semantic' &&
      WEAK_PROVIDER_CATEGORIES.has(currentCategory));
  return shouldOverride ? decision.category : currentCategory;
}

/**
 * Apply canonical rules directly to normalized provider inputs.
 * @param changes Stable IDs and normalized titles sent to the provider.
 * @param assignments Provider assignments keyed by change ID.
 * @returns Provider assignments corrected by deterministic precedence.
 */
export function applyDeterministicTitleClassification(
  changes: readonly ClassificationChange[],
  assignments: CategoryAssignments,
): CategoryAssignments {
  const adjusted = { ...assignments };
  for (const change of changes) {
    const currentCategory = adjusted[change.id] ?? SECTION_CHORE;
    adjusted[change.id] = categoryAfterDeterministicRules(
      currentCategory,
      classifyTitleDeterministically(change.title, change.breaking),
    );
  }
  return adjusted;
}

/**
 * Apply canonical hard rules and semantic corrections to provider assignments.
 * @param changes Canonical release changes to reconcile.
 * @param assignments Provider or fallback assignments keyed by change ID.
 * @param classificationChanges Normalized titles sent to the provider.
 * @returns Assignments corrected by the deterministic precedence.
 */
export function applyDeterministicClassification(
  changes: readonly ReleaseChange[],
  assignments: CategoryAssignments,
  classificationChanges: readonly ClassificationChange[] = [],
): CategoryAssignments {
  const adjusted = { ...assignments };
  const classificationTitles = new Map(
    classificationChanges.map(({ id, title }) => [id, title]),
  );
  const classificationBreaking = new Map(
    classificationChanges.map(({ id, breaking }) => [id, breaking]),
  );

  for (const change of changes) {
    const isBreaking = change.breaking ?? classificationBreaking.get(change.id);
    const decision = strongestClassification(
      changeTitles(change, classificationTitles.get(change.id)),
      isBreaking,
    );
    const currentCategory = adjusted[change.id] ?? SECTION_CHORE;
    adjusted[change.id] = categoryAfterDeterministicRules(
      currentCategory,
      decision,
    );
  }

  return adjusted;
}
