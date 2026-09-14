import { ValidationItem } from '../types';
import { findBalancedBlock } from './braceScanner';

export interface LegacyUniversalResult {
  code: string;
  modified: boolean;
  changes: string[];
  requiresInlinePageMap: boolean;
}

export function isLegacyUniversalRuntime(code: string): boolean {
  return Boolean(code && /\bSafeSCORM\b/.test(code) && /\bCOURSE_SETTINGS\b/.test(code) && /window\.assessmentData\s*=/.test(code));
}
