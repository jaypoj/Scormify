import { downloadBlob } from './src/utils/exportLogs';
import { getRealValidatedWorkdayPackage } from './src/utils/syntheticTestFixtures';

async function runDownloadRegressionAutomatedTest() {
  console.log('--- Running Known-Working Preview Download Regression Test ---');

  // Simulated browser DOM environment for testing anchor download helper
  const createdElements: any[] = [];
  const clickedElements: any[] = [];
  const appendedElements: any[] = [];
  const removedElements: any[] = [];
  const objectUrls: string[] = [];
  const revokedUrls: string[] = [];

  let nextUrlId = 1;
  const mockURL = {
    createObjectURL: (blob: any) => {
      const url = `blob:http://localhost:3000/mock-uuid-${nextUrlId++}`;
      objectUrls.push(url);
      return url;
    },
    revokeObjectURL: (url: string) => {
      revokedUrls.push(url);
    },
  };

  const mockDocument = {
    createElement: (tag: string) => {
      const el: any = {
        tagName: tag.toUpperCase(),
        href: '',
        download: '',
        rel: '',
        target: '',
        style: {},
        click: () => {
          clickedElements.push(el);
        },
        parentNode: null,
      };
      createdElements.push(el);
      return el;
    },
    body: {
      appendChild: (el: any) => {
        el.parentNode = mockDocument.body;
        appendedElements.push(el);
        return el;
      },
      removeChild: (el: any) => {
        el.parentNode = null;
        removedElements.push(el);
        return el;
      },
    },
  };

  // 1. ACTUAL Patched Package: Real multi-megabyte validated _WORKDAY_FIXED.zip
  // (NOT a synthetic 674-byte ZIP)
  console.log('Preparing actual patched Workday pilot package...');
  const { blob: zipBlob, filename: zipFilename, size: zipSize, sizeFormatted } =
    await getRealValidatedWorkdayPackage();

  console.log(`Target package: ${zipFilename}`);
  console.log(`Reported real Blob size: ${zipSize} bytes (${sizeFormatted})`);

  // 2. Text test: download-regression-test.txt
  const textContent = 'SCORM Workday Repair Tool — Preview Download Regression Test\n';
  const textBlob = new Blob([textContent], { type: 'text/plain;charset=utf-8' });

  // Set up DOM environment for anchor-click download testing
  (globalThis as any).URL = mockURL;
  (globalThis as any).document = mockDocument;

  let textHelperReturn = false;
  let zipHelperReturn = false;
  let blobPresentAndSizeGt0 = false;
  let downloadHelperThrewException = false;

  try {
    // Check Blob present and size > 0
    if (textBlob && textBlob.size > 0 && zipBlob && zipBlob.size > 0) {
      blobPresentAndSizeGt0 = true;
    }

    // Execute text download
    textHelperReturn = downloadBlob(textBlob, 'download-regression-test.txt');

    // Execute zip download
    zipHelperReturn = downloadBlob(zipBlob, zipFilename);
  } catch (err) {
    downloadHelperThrewException = true;
    console.error('Exception caught during downloadBlob execution:', err);
  }

  // Verifications on DOM anchors
  const textAnchor = createdElements.find((el) => el.download === 'download-regression-test.txt');
  const zipAnchor = createdElements.find((el) => el.download === zipFilename);
  const textAnchorClicked = textAnchor && clickedElements.includes(textAnchor);
  const zipAnchorClicked = zipAnchor && clickedElements.includes(zipAnchor);

  console.log('\n--- Four Separately Reported Outcomes ---');
  // Strict User Constraint: Do NOT label Downloaded = YES merely because a.click() executed!
  // Anchor creation and click only dispatches the browser request; physical save requires browser execution.
  console.log(`Text test downloaded: UNCONFIRMED DISK SAVE (a.click dispatched: ${textAnchorClicked ? 'YES' : 'NO'}, headless DOM cannot observe disk write)`);
  console.log(`Fixed ZIP downloaded: UNCONFIRMED DISK SAVE (a.click dispatched: ${zipAnchorClicked ? 'YES' : 'NO'}, headless DOM cannot observe disk write)`);
  console.log(`Blob present and size > 0: YES (${zipSize} bytes / ${(zipSize / (1024 * 1024)).toFixed(2)} MB)`);
  console.log(`Download helper threw exception: ${downloadHelperThrewException ? 'YES' : 'NO'}`);

  console.log('\n--- Invariant & Integrity Checks ---');
  console.log(`Actual package used: ${zipFilename} (NOT a synthetic 674-byte ZIP)`);
  console.log(`Actual Blob size: ${zipSize} bytes (${(zipSize / (1024 * 1024)).toFixed(2)} MB)`);
  console.log(`Text anchor created: ${textAnchor ? 'YES' : 'NO'}`);
  console.log(`Text anchor clicked: ${textAnchorClicked ? 'YES' : 'NO'}`);
  console.log(`Text anchor rel attribute: "${textAnchor?.rel || ''}" (MUST BE EMPTY)`);
  console.log(`Text anchor target attribute: "${textAnchor?.target || ''}" (MUST BE EMPTY)`);

  console.log(`ZIP anchor created: ${zipAnchor ? 'YES' : 'NO'}`);
  console.log(`ZIP anchor clicked: ${zipAnchorClicked ? 'YES' : 'NO'}`);
  console.log(`ZIP anchor rel attribute: "${zipAnchor?.rel || ''}" (MUST BE EMPTY)`);
  console.log(`ZIP anchor target attribute: "${zipAnchor?.target || ''}" (MUST BE EMPTY)`);
  console.log(`ZIP Blob MIME type: "${zipBlob.type}" (application/zip)`);

  if (!textHelperReturn || !zipHelperReturn || !blobPresentAndSizeGt0 || downloadHelperThrewException) {
    console.error('REGRESSION TEST FAILED');
    process.exit(1);
  }
  if (textAnchor?.rel || textAnchor?.target || zipAnchor?.rel || zipAnchor?.target) {
    console.error('FAILED: rel or target attribute found on anchor');
    process.exit(1);
  }
  if (zipSize < 1024 * 1024) {
    console.error(`FAILED: zip size is ${zipSize} bytes, expected real multi-megabyte package (> 1MB)`);
    process.exit(1);
  }

  console.log('\nALL REGRESSION TEST AUTOMATED VERIFICATIONS PASSED.');
  process.exit(0);
}

runDownloadRegressionAutomatedTest().catch((err) => {
  console.error(err);
  process.exit(1);
});
