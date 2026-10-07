const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const fs = require('fs');
(async () => {
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await b.newPage();
  p.on('console', (m) => console.log('LOG', m.text())); p.on('pageerror', (e) => console.log('ERR', e.message));
  await p.goto('http://127.0.0.1:4610/render.html' + (process.argv[3] || ''));
  await p.waitForFunction(() => window.RESULT, null, { timeout: 120000 });
  const r = await p.evaluate(() => window.RESULT);
  const out = process.argv[2]; fs.mkdirSync(out, { recursive: true });
  for (const [id, url] of Object.entries(r.sheets)) fs.writeFileSync(`${out}/cast-${id}.png`, Buffer.from(url.split(',')[1], 'base64'));
  fs.writeFileSync(`${out}/cast.json`, JSON.stringify({ meta: r.meta, chars: r.chars }, null, 1));
  console.log(JSON.stringify(r.meta), r.chars.map((c) => c.id + ':' + c.name).join(' '));
  await b.close();
})();
