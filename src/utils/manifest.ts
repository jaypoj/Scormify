import { ManifestData } from '../types';

export function parseImsManifest(fileList: string[], manifestXmlContent: string | null): ManifestData {
  const rootManifest = fileList.find((f) => f.toLowerCase() === 'imsmanifest.xml');
  const anyManifest = fileList.find((f) => f.toLowerCase().endsWith('imsmanifest.xml'));

  if (!anyManifest || !manifestXmlContent) {
    return {
      present: false,
      atRoot: false,
      validXml: false,
      declaredVersion: null,
      masteryScore: null,
      masteryScoreStatus: 'MASTERY SCORE NOT FOUND',
      launchResource: null,
      referencedFiles: [],
    };
  }

  const atRoot = !!rootManifest;
  const cleanXml = manifestXmlContent.trim().replace(/^\uFEFF/, '');

  // Check basic XML structure
  const hasManifestStart = /<manifest[\s>]/i.test(cleanXml);
  const hasManifestEnd = /<\/manifest>/i.test(cleanXml) || /<manifest[^>]*\/>/i.test(cleanXml);
  const hasBasicXmlStructure = hasManifestStart && hasManifestEnd;

  let validXml = false;
  let declaredVersion: string | null = null;
  let masteryScore: number | null = null;
  let launchResource: string | null = null;
  const referencedFiles: string[] = [];

  // Try DOMParser if in browser environment
  let domParsed = false;
  if (typeof DOMParser !== 'undefined') {
    try {
      const parser = new DOMParser();
      let doc = parser.parseFromString(cleanXml, 'application/xml');
      let parserError = doc.querySelector('parsererror');

      // If entity error (e.g. unescaped &), retry with sanitized ampersands
      if (parserError && cleanXml.includes('&') && !cleanXml.includes('&amp;')) {
        const sanitized = cleanXml.replace(/&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[a-f\d]+);)/gi, '&amp;');
        doc = parser.parseFromString(sanitized, 'application/xml');
        parserError = doc.querySelector('parsererror');
      }

      if (!parserError) {
        domParsed = true;
        validXml = true;

        const schemaVersionNode = doc.querySelector('schemaversion') || doc.querySelector('schemaVersion');
        if (schemaVersionNode && schemaVersionNode.textContent) {
          declaredVersion = schemaVersionNode.textContent.trim();
        }

        const masteryScoreNode =
          doc.querySelector('masteryscore') ||
          doc.getElementsByTagNameNS('http://www.adlnet.org/xsd/adlcp_rootv1p2', 'masteryscore')[0] ||
          doc.getElementsByTagName('adlcp:masteryscore')[0];

        if (masteryScoreNode && masteryScoreNode.textContent) {
          const parsed = parseFloat(masteryScoreNode.textContent.trim());
          if (!isNaN(parsed)) {
            masteryScore = parsed;
          }
        }

        const resources = Array.from(doc.querySelectorAll('resource'));
        for (const res of resources) {
          const href = res.getAttribute('href');
          if (href) {
            launchResource = href;
            break;
          }
        }

        if (launchResource) referencedFiles.push(launchResource);
        const fileNodes = Array.from(doc.querySelectorAll('file'));
        for (const fn of fileNodes) {
          const href = fn.getAttribute('href');
          if (href && !referencedFiles.includes(href)) {
            referencedFiles.push(href);
          }
        }
      }
    } catch {
      domParsed = false;
    }
  }

  // Fallback / Regex-based parsing (when DOMParser is unavailable or encountered non-fatal parsing nuance)
  if (!domParsed) {
    if (hasBasicXmlStructure) {
      validXml = true;
    }

    // Version detection
    const schemaMatch = cleanXml.match(/<[^:]*:?schemaversion[^>]*>([^<]+)<\/[^:]*:?schemaversion>/i);
    if (schemaMatch) {
      declaredVersion = schemaMatch[1].trim();
    }

    // Mastery score detection
    const scoreMatch = cleanXml.match(/<[^:]*:?masteryscore[^>]*>(\d+(?:\.\d+)?)<\/[^:]*:?masteryscore>/i);
    if (scoreMatch) {
      masteryScore = parseFloat(scoreMatch[1]);
    }

    // Launch resource detection
    const resMatch = cleanXml.match(/<resource[^>]+href=["']([^"']+)["']/i);
    if (resMatch) {
      launchResource = resMatch[1];
      if (!referencedFiles.includes(launchResource)) {
        referencedFiles.push(launchResource);
      }
    }

    // Referenced files detection
    const fileRegex = /<file[^>]+href=["']([^"']+)["']/gi;
    let fileMatch;
    while ((fileMatch = fileRegex.exec(cleanXml)) !== null) {
      if (fileMatch[1] && !referencedFiles.includes(fileMatch[1])) {
        referencedFiles.push(fileMatch[1]);
      }
    }
  }

  // Fallback version heuristics
  if (!declaredVersion) {
    const rawLower = cleanXml.toLowerCase();
    if (rawLower.includes('adlcp:scormtype') || rawLower.includes('adlcp_rootv1p2')) {
      declaredVersion = '1.2';
    } else if (
      rawLower.includes('adlcp_v1p3') ||
      rawLower.includes('scorm_2004') ||
      rawLower.includes('2004 3rd') ||
      rawLower.includes('2004 4th')
    ) {
      declaredVersion = '2004';
    }
  }

  // Fallback mastery score if namespaces confused DOM
  if (masteryScore === null) {
    const scoreMatch = cleanXml.match(/<[^:]*:?masteryscore[^>]*>(\d+(?:\.\d+)?)<\/[^:]*:?masteryscore>/i);
    if (scoreMatch) {
      masteryScore = parseFloat(scoreMatch[1]);
    }
  }

  let masteryScoreStatus: 'PASS' | 'OTHER' | 'MASTERY SCORE NOT FOUND' = 'MASTERY SCORE NOT FOUND';
  if (masteryScore !== null) {
    if (masteryScore === 80) {
      masteryScoreStatus = 'PASS';
    } else {
      masteryScoreStatus = 'OTHER';
    }
  }

  return {
    present: true,
    atRoot,
    validXml,
    declaredVersion,
    masteryScore,
    masteryScoreStatus,
    launchResource,
    referencedFiles,
    rawXmlSnippet: cleanXml.slice(0, 400),
  };
}
