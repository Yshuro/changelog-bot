import { CLOSING_FENCE_RE, OPENING_FENCE_RE } from '@/constants/markdown.js';

const MIN_MARKDOWN_ATX_HEADING_LEVEL = 1;
const RELEASE_SECTION_HEADING_LEVEL = 2;
/** Heading depth used to render additional release-note sections. */
export const CHANGELOG_ADDITIONAL_SECTION_HEADING_LEVEL = 3;
const HEADING_LEVEL_STEP = 1;
const MAX_MARKDOWN_ATX_HEADING_LEVEL = 6;
const ATX_HEADING_MARKER_RE_SOURCE = `#{${MIN_MARKDOWN_ATX_HEADING_LEVEL},${MAX_MARKDOWN_ATX_HEADING_LEVEL}}`;
const ATX_HEADING_RE = new RegExp(
  `^(${ATX_HEADING_MARKER_RE_SOURCE})(?!#)\\s+(.*)$`,
);
const H2_HEADING_RE = new RegExp(
  `^${'#'.repeat(RELEASE_SECTION_HEADING_LEVEL)}\\s+(.*)$`,
);
const PREFIXED_ATX_HEADING_RE = new RegExp(
  `^([^\\p{L}\\p{N}#>*+-]+?)(${ATX_HEADING_MARKER_RE_SOURCE})(?!#)\\s+(.*)$`,
  'u',
);
const PREFIXED_HEADING_MARKER_MATCH_INDEX = 2;
const PREFIXED_HEADING_TEXT_MATCH_INDEX = 3;
const HEADING_MARKER_MATCH_INDEX = 1;
const HEADING_TEXT_MATCH_INDEX = 2;
const RELEASE_HEADING_TEXT_MATCH_INDEX = 1;
const FENCE_MARKER_MATCH_INDEX = 1;
const MIN_NESTED_ADDITIONAL_SECTION_HEADING_LEVEL =
  CHANGELOG_ADDITIONAL_SECTION_HEADING_LEVEL + HEADING_LEVEL_STEP;

/** Captures an H2 heading and its associated markdown lines. */
export type RawReleaseSection = {
  /** Raw heading text without the leading markdown marker. */
  heading: string;
  /** Lines belonging to the section body. */
  lines: string[];
};

/** Opening delimiter of the fenced code block being read. */
type OpenCodeFence = {
  /** Fence character, a backtick or a tilde. */
  marker: string;
  /** Number of fence characters in the opening delimiter. */
  length: number;
};

/** Fence state after reading one line. */
type CodeFenceStep = {
  /** Fence still open after the line, if any. */
  openFence: OpenCodeFence | undefined;
  /** Whether the line opened or closed a fence. */
  isDelimiter: boolean;
};

/**
 * Advance fenced code block tracking by one line.
 * @param line Markdown line being read.
 * @param openFence Fence open before this line, if any.
 * @returns Fence state after the line.
 */
function trackCodeFence(
  line: string,
  openFence: OpenCodeFence | undefined,
): CodeFenceStep {
  if (!openFence) {
    const openMatch = line.match(OPENING_FENCE_RE);
    if (!openMatch) return { openFence: undefined, isDelimiter: false };
    const [, openDelimiter, infoString] = openMatch;
    // WHY: CommonMark permits backticks in tilde fence info strings only, so a
    // line like ```a`b``` is inline code rather than an opening fence.
    if (openDelimiter.startsWith('`') && infoString.includes('`')) {
      return { openFence: undefined, isDelimiter: false };
    }
    return {
      openFence: {
        marker: openDelimiter.charAt(0),
        length: openDelimiter.length,
      },
      isDelimiter: true,
    };
  }

  const closeDelimiter =
    line.match(CLOSING_FENCE_RE)?.[FENCE_MARKER_MATCH_INDEX];
  // WHY: CommonMark closes a fence only with the same character, at least as
  // many of them, and nothing after it, so a nested ``` inside a ```` block or
  // a ```ts line inside a ``` block stays example content.
  const closesFence =
    closeDelimiter !== undefined &&
    closeDelimiter.charAt(0) === openFence.marker &&
    closeDelimiter.length >= openFence.length;
  return closesFence
    ? { openFence: undefined, isDelimiter: true }
    : { openFence, isDelimiter: false };
}

function normalizeReleaseHeadingLine(line: string): string {
  if (ATX_HEADING_RE.test(line)) return line;

  const prefixedHeadingMatch = line.match(PREFIXED_ATX_HEADING_RE);
  if (!prefixedHeadingMatch) return line;

  return [
    prefixedHeadingMatch[PREFIXED_HEADING_MARKER_MATCH_INDEX],
    prefixedHeadingMatch[PREFIXED_HEADING_TEXT_MATCH_INDEX],
  ].join(' ');
}

function parseReleaseHeading(line: string): string | undefined {
  const headingMatch = line.match(H2_HEADING_RE);
  return headingMatch
    ? headingMatch[RELEASE_HEADING_TEXT_MATCH_INDEX].trim()
    : undefined;
}

/**
 * Collect H2 sections and their lines from a release body.
 * @param body Full release body markdown.
 * @returns Sections preserving their original order.
 */
export function collectReleaseH2Sections(body: string): RawReleaseSection[] {
  const lines = body.split(/\r?\n/);
  const sections: RawReleaseSection[] = [];
  let currentSection: RawReleaseSection | null = null;
  let openFence: OpenCodeFence | undefined;

  for (const rawLine of lines) {
    const fenceStep = trackCodeFence(rawLine, openFence);
    // WHY: Release notes often carry markdown examples. A heading-shaped line
    // inside a fenced code block is example content, so keep it verbatim and
    // never let it start a new release section.
    if (openFence || fenceStep.isDelimiter) {
      openFence = fenceStep.openFence;
      if (currentSection) currentSection.lines.push(rawLine);
      continue;
    }

    // WHY: Workflow inputs can introduce stray non-text prefixes before
    // headings, so normalize only heading-shaped lines before H2 detection.
    const line = normalizeReleaseHeadingLine(rawLine);
    const heading = parseReleaseHeading(line);
    if (heading) {
      if (currentSection) sections.push(currentSection);
      currentSection = { heading, lines: [] };
      continue;
    }
    if (currentSection) currentSection.lines.push(line);
  }

  if (currentSection) sections.push(currentSection);
  return sections;
}

/**
 * Collect the lines that appear before the first H2 heading of a release body.
 * @param body Full release body markdown.
 * @returns Introductory lines, or an empty list when the body has no H2 heading.
 */
export function collectReleasePreamble(body: string): string[] {
  const lines = body.split(/\r?\n/);
  const preamble: string[] = [];
  let openFence: OpenCodeFence | undefined;

  for (const rawLine of lines) {
    const fenceStep = trackCodeFence(rawLine, openFence);
    // WHY: Match collectReleaseH2Sections, so an example heading inside a
    // fence neither ends the preamble nor is rewritten.
    if (openFence || fenceStep.isDelimiter) {
      openFence = fenceStep.openFence;
      preamble.push(rawLine);
      continue;
    }

    const line = normalizeReleaseHeadingLine(rawLine);
    if (parseReleaseHeading(line)) return preamble;
    preamble.push(line);
  }

  // WHY: A body without any H2 heading has no "before the first heading"
  // region. Its text is not an introduction to structured release notes, and
  // treating it as one would duplicate it next to the commit-derived entries.
  return [];
}

/**
 * Demote headings inside a release section rendered below a changelog H3.
 * @param body Additional release-note section body.
 * @returns Body with nested headings adjusted while code fences remain intact.
 */
export function demoteAdditionalSectionHeadings(body: string): string {
  let inFence = false;
  let fenceMarker: string | undefined;

  return body
    .split('\n')
    .map((rawLine) => {
      const line = inFence ? rawLine : normalizeReleaseHeadingLine(rawLine);
      const fenceMatch = line.match(/^\s*(```|~~~)/);
      if (fenceMatch) {
        const marker = fenceMatch[FENCE_MARKER_MATCH_INDEX];
        if (!inFence) {
          inFence = true;
          fenceMarker = marker;
        } else if (marker === fenceMarker) {
          inFence = false;
          fenceMarker = undefined;
        }
        return line;
      }

      if (inFence) return line;

      const headingMatch = line.match(ATX_HEADING_RE);
      if (!headingMatch) return line;

      const headingLevel = headingMatch[HEADING_MARKER_MATCH_INDEX].length;
      const nestedLevel = Math.min(
        Math.max(
          headingLevel + HEADING_LEVEL_STEP,
          MIN_NESTED_ADDITIONAL_SECTION_HEADING_LEVEL,
        ),
        MAX_MARKDOWN_ATX_HEADING_LEVEL,
      );
      return `${'#'.repeat(nestedLevel)} ${headingMatch[HEADING_TEXT_MATCH_INDEX]}`;
    })
    .join('\n');
}
