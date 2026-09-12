import { PassScoreEvidence, ManifestData } from '../types';

export interface FileContentMap {
  [fileName: string]: string;
}

export interface PassScoreAnalysisResult {
  manifestMasteryScore: number | null;
  runtimeQuizThreshold: string; // e.g. "80" or "Not Found"
  passScoreConsistency: 'CONSISTENT' | 'PASS SCORE CONFLICT — MANUAL REVIEW' | 'INSUFFICIENT DATA';
  passScoreReferences: PassScoreEvidence[];
  warnings: string[];
}

/**
 * Searches for and logs EACH pass score source independently:
 * - Manifest: <adlcp:masteryscore>80</adlcp:masteryscore>
 * - Runtime code: score >= 80, rawScore >= 80, percentage >= passingScore, etc.
 * - Configurations: const passingScore = 80, passMark: 80, COURSE_SETTINGS.passMark
 * - project.json: "passingScore": 80, "passMark": 80
 * - UI text: Pass mark: 80%, Passing score: 80%
 */
export function detectAllPassScores(
  manifestData: ManifestData,
  fileContents: FileContentMap
): PassScoreAnalysisResult {
  const references: PassScoreEvidence[] = [];
  const runtimeScores: number[] = [];
  const warnings: string[] = [];

  // 1. Manifest Mastery Score
  if (manifestData.masteryScore !== null) {
    references.push({
      source: 'imsmanifest.xml',
      sourceType: 'Manifest',
      fieldOrPattern: '<adlcp:masteryscore>',
      score: manifestData.masteryScore,
      context: `<adlcp:masteryscore>${manifestData.masteryScore}</adlcp:masteryscore>`,
    });
  }

  // 2. Project.json
  for (const [fileName, content] of Object.entries(fileContents)) {
    if (!content) continue;
    if (fileName.toLowerCase().endsWith('project.json')) {
      const pScoreMatches = Array.from(
        content.matchAll(/["'](?:passingScore|passMark|masteryScore|threshold)["']\s*:\s*(\d+(?:\.\d+)?)/gi)
      );
      for (const m of pScoreMatches) {
        const val = parseFloat(m[1]);
        if (!isNaN(val) && val > 0 && val <= 100) {
          references.push({
            source: fileName,
            sourceType: 'ProjectJson',
            fieldOrPattern: m[0],
            score: val,
            context: content.slice(Math.max(0, m.index! - 30), Math.min(content.length, m.index! + 60)).trim(),
          });
          runtimeScores.push(val);
        }
      }
    }
  }

  // 3. Runtime & Configuration & UI Text across all code and text files
  const regexDefinitions: {
    pattern: RegExp;
    sourceType: 'Configuration' | 'Runtime' | 'UI';
    label: string;
  }[] = [
    // Configuration objects & declarations
    {
      pattern: /\bCOURSE_SETTINGS\s*=\s*\{[\s\S]*?\b(?:passMark|passingScore)\s*:\s*(\d+(?:\.\d+)?)/i,
      sourceType: 'Configuration',
      label: 'COURSE_SETTINGS.passMark declaration',
    },
    {
      pattern: /\b(?:const|let|var)\s+(?:passingScore|passMark|masteryScore|PASSING_SCORE|PASS_MARK)\s*=\s*(\d+(?:\.\d+)?)/i,
      sourceType: 'Configuration',
      label: 'passingScore/passMark variable assignment',
    },
    {
      pattern: /\b(?:passMark|passingScore|masteryScore)\s*:\s*(\d+(?:\.\d+)?)/i,
      sourceType: 'Configuration',
      label: 'passMark/passingScore object property',
    },
    // Runtime comparison logic
    {
      pattern: /\b(?:score|rawScore|userScore|finalScore|percentage|pct)\s*>=\s*(\d+(?:\.\d+)?)/i,
      sourceType: 'Runtime',
      label: 'score >= threshold runtime comparison',
    },
    {
      pattern: /\b(?:score|rawScore|userScore)\s*>=\s*(?:COURSE_SETTINGS\.passMark|passingScore|passMark)\b/i,
      sourceType: 'Runtime',
      label: 'score >= passMark runtime expression',
    },
    // UI text
    {
      pattern: /(?:Pass(?:ing)?\s*mark|Pass(?:ing)?\s*score)\s*[:=]?\s*(\d+(?:\.\d+)?)\s*%/i,
      sourceType: 'UI',
      label: 'UI pass mark text display',
    },
  ];

  for (const [fileName, content] of Object.entries(fileContents)) {
    if (!content) continue;
    const lower = fileName.toLowerCase();
    const isRelevant =
      lower.endsWith('.js') ||
      lower.endsWith('.html') ||
      lower.endsWith('.htm') ||
      lower.endsWith('.json');
    if (!isRelevant || lower.endsWith('project.json')) continue;

    for (const def of regexDefinitions) {
      const match = content.match(def.pattern);
      if (match) {
        // If capture group 1 has a number, extract it
        let scoreVal: number | null = null;
        if (match[1]) {
          const parsed = parseFloat(match[1]);
          if (!isNaN(parsed) && parsed > 0 && parsed <= 100) {
            scoreVal = parsed;
          }
        } else if (def.label.includes('COURSE_SETTINGS.passMark')) {
          // Look up COURSE_SETTINGS in this file or fileContents
          const csMatch = content.match(/passMark\s*:\s*(\d+(?:\.\d+)?)/i);
          if (csMatch) {
            scoreVal = parseFloat(csMatch[1]);
          }
        }

        if (scoreVal !== null) {
          const start = Math.max(0, match.index! - 40);
          const end = Math.min(content.length, match.index! + match[0].length + 40);
          const ctx = content.slice(start, end).trim();

          const alreadyLogged = references.some(
            (r) => r.source === fileName && r.fieldOrPattern === def.label && r.score === scoreVal
          );

          if (!alreadyLogged) {
            references.push({
              source: fileName,
              sourceType: def.sourceType,
              fieldOrPattern: def.label,
              score: scoreVal,
              context: ctx,
            });
            if (def.sourceType === 'Runtime' || def.sourceType === 'Configuration') {
              runtimeScores.push(scoreVal);
            }
          }
        }
      }
    }
  }

  // 4. Synthesize Runtime Quiz Threshold independently from Manifest
  let runtimeQuizThreshold = 'Not Found';
  if (runtimeScores.length > 0) {
    runtimeQuizThreshold = String(runtimeScores[0]);
  }

  // 5. Evaluate consistency
  let passScoreConsistency: PassScoreAnalysisResult['passScoreConsistency'] = 'INSUFFICIENT DATA';

  const manifestScore = manifestData.masteryScore;
  const hasManifest = manifestScore !== null;
  const hasRuntime = runtimeScores.length > 0;

  if (hasManifest && hasRuntime) {
    const allRuntimeSame = runtimeScores.every((s) => s === runtimeScores[0]);
    if (allRuntimeSame && runtimeScores[0] === manifestScore) {
      passScoreConsistency = 'CONSISTENT';
    } else {
      passScoreConsistency = 'PASS SCORE CONFLICT — MANUAL REVIEW';
      warnings.push(
        `Pass score conflict: Manifest specifies ${manifestScore} but runtime uses ${runtimeScores.join(', ')}`
      );
    }
  } else if (hasManifest && manifestScore === 80) {
    passScoreConsistency = 'CONSISTENT';
  } else if (hasRuntime && runtimeScores.every((s) => s === 80)) {
    passScoreConsistency = 'CONSISTENT';
  }

  return {
    manifestMasteryScore: manifestScore,
    runtimeQuizThreshold,
    passScoreConsistency,
    passScoreReferences: references,
    warnings,
  };
}
