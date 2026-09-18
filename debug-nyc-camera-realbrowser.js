const { chromium } = require('playwright');

// Temporary (removed after use) — every server-side/header probe so far has
// come back clean, but the user still sees a blank camera popup after a
// hard refresh AND incognito, which rules out caching. This is the test
// that was actually missing: a real browser, loading the real production
// URL, clicking a real camera marker, and capturing what actually happens
// (console errors, failed requests, the real response headers a browser
// sees) instead of reasoning about it from a Node https.get probe.
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();

  const consoleMessages = [];
  const failedRequests = [];
  const imageResponses = [];
  page.on('console', msg => consoleMessages.push(`[${msg.type()}] ${msg.text()}`));
  page.on('pageerror', e => consoleMessages.push(`[pageerror] ${e.message}`));
  page.on('requestfailed', req => failedRequests.push(`${req.method()} ${req.url()} -> ${req.failure()?.errorText}`));
  page.on('response', res => {
    if (res.url().includes('nyctmc.org')) {
      imageResponses.push({ url: res.url(), status: res.status(), headers: res.headers() });
    }
  });

  console.log('Navigating to production page...');
  await page.goto('https://www.cognitivegroup.com/tactical.html', { waitUntil: 'networkidle', timeout: 30000 });

  console.log('Switching to NYC region...');
  await page.selectOption('#region-select', 'nyc');
  await page.waitForTimeout(4000);

  const cameraIds = await page.evaluate(() => Object.keys(cameraMarkers));
  console.log('camera markers currently rendered:', cameraIds.length);
  console.log('sample ids:', cameraIds.slice(0, 5));

  if (cameraIds.length === 0) {
    console.log('NO CAMERA MARKERS FOUND — nothing to click, investigate fetchCameras/renderCameras instead.');
  } else {
    const targetId = cameraIds[0];
    const camData = await page.evaluate((id) => allCameras.find(c => c.id === id), targetId);
    console.log('clicking camera:', JSON.stringify(camData));

    await page.evaluate((id) => { cameraMarkers[id].fire('click'); }, targetId);
    await page.waitForTimeout(3000);

    const popupHtml = await page.evaluate((id) => cameraMarkers[id].getPopup()?.getElement()?.innerHTML || null, targetId);
    console.log('\n--- POPUP HTML ---');
    console.log(popupHtml);

    await page.screenshot({ path: 'camera-popup.png', fullPage: false });
    console.log('\nScreenshot saved to camera-popup.png');
  }

  console.log('\n--- IMAGE RESPONSES SEEN BY THE REAL BROWSER ---');
  imageResponses.forEach(r => console.log(JSON.stringify(r, null, 2)));

  console.log('\n--- CONSOLE / PAGE ERRORS ---');
  consoleMessages.forEach(m => console.log(m));

  console.log('\n--- FAILED REQUESTS ---');
  failedRequests.forEach(f => console.log(f));

  await browser.close();
})().catch(e => { console.error('probe failed:', e); process.exit(1); });
