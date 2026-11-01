import asyncio, os, pathlib, sys
from playwright.async_api import async_playwright
OUT = sys.argv[1] if len(sys.argv) > 1 else 'shots'
os.makedirs(OUT, exist_ok=True)
URL = (pathlib.Path(__file__).resolve().parent.parent / 'dist/index.html').as_uri()
CHROME = os.environ.get('CHROME')  # optional path to a Chrome binary

HEX_TO_SCREEN = """([c, r]) => {const {cam} = window.__woerth; const S = 30, SQ3 = Math.sqrt(3), M = 34;
  const x = M + S * SQ3 * (c + 0.5 * (r & 1)) + S * SQ3 / 2, y = M + S + S * 1.5 * r;
  const b = document.getElementById('map').getBoundingClientRect(); return [(x - cam.x) * cam.z + b.left, (y - cam.y) * cam.z + b.top];}"""

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path=CHROME, args=['--no-sandbox']) if CHROME else await p.chromium.launch()
        ctx = await b.new_context(viewport={'width': 402, 'height': 874}, device_scale_factor=3, is_mobile=True, has_touch=True)
        page = await ctx.new_page()
        errs = []
        page.on('console', lambda m: errs.append(m.type + ': ' + m.text) if m.type in ('error', 'warning') and 'ERR_TUNNEL' not in m.text else None)
        page.on('pageerror', lambda e: errs.append('pageerror: ' + str(e)))
        await page.goto(URL); await page.wait_for_timeout(1500)
        await page.screenshot(path=f'{OUT}/01-title.png')
        # the introduction, page by page
        await page.click('[data-start="de"]'); await page.wait_for_timeout(300)
        for k in range(5):
            await page.screenshot(path=f'{OUT}/02-intro-{k + 1}.png', full_page=False)
            if k == 2:  # the commanders page is long: capture it scrolled too
                await page.evaluate("document.getElementById('overlay').scrollTop = 99999"); await page.wait_for_timeout(150)
                await page.screenshot(path=f'{OUT}/02-intro-3b.png')
            if k < 4:
                await page.click('[data-intro="next"]'); await page.wait_for_timeout(250)
        await page.click('[data-intro="go"]'); await page.wait_for_timeout(1200)
        await page.screenshot(path=f'{OUT}/03-start.png')

        async def tap_hex(c, r):
            pos = await page.evaluate(HEX_TO_SCREEN, [c, r])
            await page.touchscreen.tap(pos[0], pos[1]); await page.wait_for_timeout(400)
        async def tap_unit(uid):
            # centre the camera on the unit first, so the tap lands on the map
            cr = await page.evaluate("""(id)=>{const {G,cam}=window.__woerth;const u=G.state.units.find(x=>x.id===id);
              const S=30,SQ3=Math.sqrt(3),M=34,b=document.getElementById('map').getBoundingClientRect();
              cam.x=M+S*SQ3*(u.c+0.5*(u.r&1))+S*SQ3/2-b.width/cam.z/2; cam.y=M+S+S*1.5*u.r-b.height/cam.z/2; return [u.c,u.r]}""", uid)
            await tap_hex(*cr)

        # artillery fire
        await tap_unit('de-ka5')
        tgt = await page.evaluate("()=>window.__woerth.G.targets.map(t=>t.id)")
        print('KA5 targets', tgt)
        if tgt:
            await tap_unit(tgt[0])
            await page.screenshot(path=f'{OUT}/04-forecast.png')
            await page.click('[data-act="fire"]'); await page.wait_for_timeout(1500)
        # refit: wear down the 20th brigade, which stands next to Preuschdorf
        await page.evaluate("()=>{const s=window.__woerth.G.state;s.units.find(u=>u.id==='de-20').str=6;s.res.de=9;}")
        await tap_unit('de-20')
        await page.screenshot(path=f'{OUT}/05-refit.png')
        await page.click('#card [data-act="refit"]'); await page.wait_for_timeout(700)
        await page.screenshot(path=f'{OUT}/06-after-refit.png')
        # call-up at Spachbach
        await page.evaluate("()=>{window.__woerth.G.state.res.de=12;}")
        await tap_hex(11, 9)
        await page.screenshot(path=f'{OUT}/07-callup.png')
        await page.click('#card [data-act="callup"]'); await page.wait_for_timeout(700)
        await page.screenshot(path=f'{OUT}/08-after-callup.png')
        # enemy commander: card and command ring
        await tap_unit('fr-mm')
        await page.screenshot(path=f'{OUT}/09-macmahon.png')
        # end turn and let the computer play
        await page.click('[data-act="end"]'); await page.wait_for_timeout(200)
        if await page.evaluate("()=>window.__woerth.G.confirmEnd"):
            await page.click('[data-act="end"]')
        await page.wait_for_timeout(2500)
        await page.screenshot(path=f'{OUT}/10-ai-turn.png')
        await page.wait_for_function("()=>!window.__woerth.G.ai", timeout=60000)
        await page.wait_for_timeout(600)
        await page.screenshot(path=f'{OUT}/11-after-ai.png')
        # landscape
        await page.set_viewport_size({'width': 874, 'height': 402}); await page.wait_for_timeout(700)
        await tap_unit('de-17')
        await page.screenshot(path=f'{OUT}/12-landscape.png')
        await page.set_viewport_size({'width': 402, 'height': 874}); await page.wait_for_timeout(500)
        await page.click('#menuBtn'); await page.wait_for_timeout(300)
        await page.screenshot(path=f'{OUT}/13-menu.png')
        await page.click('[data-menu="intro"]'); await page.wait_for_timeout(300)
        await page.click('[data-intro="skip"]'); await page.wait_for_timeout(300)
        await page.screenshot(path=f'{OUT}/14-orders-review.png')
        await page.click('[data-intro="close"]'); await page.wait_for_timeout(300)
        hs = await page.evaluate("()=>[document.documentElement.scrollWidth, document.documentElement.clientWidth, document.body.scrollHeight, innerHeight]")
        print('scroll dims', hs)
        print('\n'.join(errs) or 'no console errors')
        await b.close()
asyncio.run(main())
