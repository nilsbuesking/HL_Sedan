import asyncio, os, pathlib, sys
from playwright.async_api import async_playwright
OUT = sys.argv[1] if len(sys.argv) > 1 else 'shots'
os.makedirs(OUT, exist_ok=True)
URL = (pathlib.Path(__file__).resolve().parent.parent / 'dist/index.html').as_uri()
CHROME = os.environ.get('CHROME')  # optional path to a Chrome binary
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path=CHROME, args=['--no-sandbox']) if CHROME else await p.chromium.launch()
        ctx = await b.new_context(viewport={'width': 402, 'height': 874}, device_scale_factor=3, is_mobile=True, has_touch=True)
        page = await ctx.new_page()
        errs = []
        page.on('console', lambda m: errs.append(m.type + ': ' + m.text) if m.type in ('error', 'warning') else None)
        page.on('pageerror', lambda e: errs.append('pageerror: ' + str(e)))
        await page.goto(URL); await page.wait_for_timeout(1500)
        await page.screenshot(path=f'{OUT}/1-briefing.png')
        await page.click('[data-start="de"]'); await page.wait_for_timeout(1200)
        await page.screenshot(path=f'{OUT}/2-start.png')
        # tap the German 19th brigade
        async def tap_unit(uid):
            pos = await page.evaluate("""(uid)=>{const {G,cam,E}=window.__woerth;const u=G.state.units.find(x=>x.id===uid);
              const S=30,SQ3=Math.sqrt(3),M=34;const x=M+S*SQ3*(u.c+0.5*(u.r&1))+S*SQ3/2,y=M+S+S*1.5*u.r;
              const r=document.getElementById('map').getBoundingClientRect();return [(x-cam.x)*cam.z+r.left,(y-cam.y)*cam.z+r.top];}""", uid)
            await page.touchscreen.tap(pos[0], pos[1]); await page.wait_for_timeout(400)
            return pos
        await tap_unit('de-ka5')
        await page.screenshot(path=f'{OUT}/3-select-art.png')
        # find a target for the artillery and tap twice
        tgt = await page.evaluate("()=>{const {G}=window.__woerth;return G.targets.map(t=>t.id)}")
        print('KA5 targets', tgt)
        if tgt:
            await tap_unit(tgt[0])
            await page.screenshot(path=f'{OUT}/4-forecast.png')
            await page.click('[data-act="fire"]'); await page.wait_for_timeout(1500)
            await page.screenshot(path=f'{OUT}/5-after-fire.png')
        # end turn twice (confirm) and let AI play
        await page.click('[data-act="end"]'); await page.wait_for_timeout(200)
        await page.click('[data-act="end"]'); await page.wait_for_timeout(2500)
        await page.screenshot(path=f'{OUT}/6-ai-turn.png')
        await page.wait_for_function("()=>!window.__woerth.G.ai", timeout=60000)
        await page.wait_for_timeout(600)
        await page.screenshot(path=f'{OUT}/7-after-ai.png')
        # landscape
        await page.set_viewport_size({'width': 874, 'height': 402}); await page.wait_for_timeout(700)
        await tap_unit('de-17')
        await page.screenshot(path=f'{OUT}/8-landscape.png')
        await page.set_viewport_size({'width': 402, 'height': 874}); await page.wait_for_timeout(500)
        await page.click('#menuBtn'); await page.wait_for_timeout(300)
        await page.screenshot(path=f'{OUT}/9-menu.png')
        hs = await page.evaluate("()=>[document.documentElement.scrollWidth, document.documentElement.clientWidth, document.body.scrollHeight, innerHeight]")
        print('scroll dims', hs)
        print('\n'.join(errs) or 'no console errors')
        await b.close()
asyncio.run(main())
