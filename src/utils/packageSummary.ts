import { PackageInspectionResult } from '../types';

export interface PreFixIssueItem {
  id: string;
  title: string;
  category: 'STATE' | 'DEFECT' | 'UX' | 'SCORE' | 'STRUCTURE';
  details?: string;
}

/**
 * Returns a list of detected pre-fix issues for a package before remediation.
 */
export function getPreFixIssues(pkg: PackageInspectionResult): string[] {
  const issues: string[] = [];

  // Check stateful findings
  if (pkg.statefulWorkdayFindings) {
    const sw = pkg.statefulWorkdayFindings;
    if (sw.globalStorageKey === 'DETECTED' || sw.stalePageStateRisk === 'DETECTED') {
      issues.push('Stale LMS/browser progress risk');
    }
    if (sw.progressExceed100Risk === 'DETECTED') {
      issues.push('Progress can exceed 100%');
    }
    if (sw.passDowngradeRisk === 'DETECTED') {
      issues.push('Previous pass can be overwritten');
    }
    if (sw.failedQuizExitUx === 'MISSING') {
      issues.push('Failed quiz has no exit workflow');
    }
    if (sw.saveAndExit === 'MISSING') {
      issues.push('Save & Exit missing');
    }
    if (sw.dynamicPageFetch === 'DETECTED') {
      issues.push('Dynamic page fetch detected');
    }
  }

  // Check the standard 4 SCORM write defects
  if (pkg.finishDefect?.detected) {
    issues.push('Finish completion defect detected');
  }
  if (pkg.progressDefect?.detected) {
    issues.push('Progress completion defect detected');
  }
  if (pkg.relaunchDefect?.detected) {
    issues.push('Relaunch reset defect detected');
  }
  if (pkg.exitDefect?.detected) {
    issues.push('Exit/unload completion defect detected');
  }

  // Check pass score conflict
  if (pkg.passScoreConsistency && pkg.passScoreConsistency.includes('CONFLICT')) {
    issues.push('Pass score conflict between manifest and code');
  }

  // If no specific defect was flagged but manual review was triggered
  if (issues.length === 0 && pkg.manualReviewReasons && pkg.manualReviewReasons.length > 0) {
    for (const r of pkg.manualReviewReasons) {
      issues.push(r);
    }
  }

  return issues;
}

/**
 * Returns formatted short profile name for display
 */
export function getProfileShortName(profile: string): string {
  switch (profile) {
    case 'KNOWN_SCORM12_STATEFUL_COMPACT_WORKDAY_V1':
      return 'STATEFUL_COMPACT';
    case 'KNOWN_SCORM12_COMPACT_QUIZ_80_V1':
      return 'COMPACT_QUIZ_80';
    case 'KNOWN_SCORM12_UNIVERSAL_QUIZ_80_V1':
      return 'UNIVERSAL_QUIZ_80';
    case 'KNOWN_SCORM12_QUIZ_80_V1':
      return 'QUIZ_80';
    case 'NONE':
      return 'NONE';
    default:
      return profile.replace(/^KNOWN_SCORM12_/, '').replace(/_V\d+$/, '') || profile;
  }
}

/**
 * Format bytes to human readable format (KB or MB)
 */
export function formatBytes(bytes: number, decimals = 1): string {
  if (!bytes || bytes <= 0) return '0 B';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
}
