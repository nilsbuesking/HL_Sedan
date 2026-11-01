import asyncio, os, pathlib, sys
from playwright.async_api import async_playwright
OUT = sys.argv[1] if len(sys.argv) > 1 else 'shots'
os.makedirs(OUT, exist_ok=True)
URL = (pathlib.Path(__file__).resolve().parent.parent / 'dist/index.html').as_uri()
CHROME = os.environ.get('CHROME')  # optional path to a Chrome binary
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path=CHROME, args=['--no-sandbox']) if CHROME else await p.chromium.launch()
        ctx = await b.new_context(viewport={'width': 402, 'height': 874}, device_scale_factor=2, is_mobile=True, has_touch=True, reduced_motion='reduce')
        page = await ctx.new_page()
        errs = []
        page.on('pageerror', lambda e: errs.append('pageerror: ' + str(e)))
        page.on('console', lambda m: errs.append(m.text) if m.type == 'error' and 'ERR_TUNNEL' not in m.text else None)
        await page.goto(URL); await page.wait_for_timeout(800)
        await page.click('[data-start="fr"]'); await page.wait_for_timeout(200)
        await page.click('[data-intro="skip"]'); await page.wait_for_timeout(200)
        await page.click('[data-intro="go"]')
        for i in range(40):
            await page.wait_for_function("()=>{const G=window.__woerth.G;return !G.ai && !G.busy}", timeout=120000)
            over = await page.evaluate("()=>!!window.__woerth.G.state.over")
            if over: break
            await page.click('[data-act="end"]'); await page.wait_for_timeout(100)
            if await page.evaluate("()=>window.__woerth.G.confirmEnd"):
                await page.click('[data-act="end"]')
            await page.wait_for_timeout(200)
        st = await page.evaluate("()=>{const s=window.__woerth.G.state;return {over:s.over, turn:s.turn}}")
        print('end state', st)
        await page.wait_for_timeout(500)
        await page.screenshot(path=f'{OUT}/10-result.png')
        # resume flow: reload and check briefing offers no resume for finished game, then start hot-seat
        await page.reload(); await page.wait_for_timeout(800)
        resume = await page.locator('[data-start="resume"]').count()
        print('resume offered after finished game:', resume)
        await page.click('[data-start="hs"]'); await page.wait_for_timeout(200)
        await page.click('[data-intro="skip"]'); await page.wait_for_timeout(200)
        await page.screenshot(path=f'{OUT}/11a-orders-both.png')
        await page.click('[data-intro="go"]'); await page.wait_for_timeout(400)
        await page.screenshot(path=f'{OUT}/11-handover.png')
        await page.click('[data-menu="close"]'); await page.wait_for_timeout(300)
        await page.reload(); await page.wait_for_timeout(800)
        print('resume offered mid-game:', await page.locator('[data-start="resume"]').count())
        print('\n'.join(errs) or 'no errors')
        await b.close()
asyncio.run(main())
