/**
 * Server-authoritative answer grading. Pure & offline: correct answers are
 * predefined in question.answerData; NO code from participants is ever
 * executed. Every match mode is unit-tested.
 */
import type { AnswerData, AnswerSubmission, MatchMode } from './types';

function normalize(s: string): string {
  return s
    .trim()
    .replace(/ /g, ' ')
    .replace(/\s+/g, ' ')
    .toLocaleLowerCase('en');
}

interface FreeTextSpec {
  accepted: string[];
  matchMode: MatchMode;
  numericTolerance?: number;
}

function withinTolerance(spec: FreeTextSpec, raw: string): boolean {
  const tol = spec.numericTolerance;
  if (tol === undefined) return false;
  const a = Number(raw.trim());
  if (!Number.isFinite(a)) return false;
  return spec.accepted.some((acc) => {
    const b = Number(acc.trim());
    return Number.isFinite(b) && Math.abs(a - b) <= tol;
  });
}

function matchesFreeText(spec: FreeTextSpec, raw: string): boolean {
  const trimmed = raw.trim();
  if (withinTolerance(spec, raw)) return true;
  switch (spec.matchMode) {
    case 'EXACT':
      return spec.accepted.some((a) => a.trim() === trimmed);
    case 'NORMALIZED': {
      const n = normalize(trimmed);
      return spec.accepted.some((a) => normalize(a) === n);
    }
    case 'CONTAINS':
      return spec.accepted.some((a) => trimmed.toLocaleLowerCase('en').includes(a.trim().toLocaleLowerCase('en')));
    case 'REGEX':
      return spec.accepted.some((a) => {
        try {
          return new RegExp(a, 'i').test(trimmed);
        } catch {
          return false; // a malformed host regex must never crash grading
        }
      });
  }
}

/** Returns true when the submission is correct for the given answer spec. */
export function gradeAnswer(answerData: AnswerData, submission: AnswerSubmission): boolean {
  switch (answerData.type) {
    case 'MULTIPLE_CHOICE':
      return submission.kind === 'mcq' && submission.selectedIndex === answerData.correctIndex;
    case 'CODING_CHALLENGE':
      if (submission.kind !== 'free') return false;
      return matchesFreeText(
        { accepted: answerData.acceptedOutputs, matchMode: answerData.matchMode, numericTolerance: answerData.numericTolerance },
        submission.text,
      );
    default:
      if (submission.kind !== 'free') return false;
      return matchesFreeText(
        { accepted: answerData.accepted, matchMode: answerData.matchMode, numericTolerance: answerData.numericTolerance },
        submission.text,
      );
  }
}