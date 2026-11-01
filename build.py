"""Bundle src/ into single-file pages.

dist/woerth.html  page body as published to claude.ai (the host adds doctype and head)
dist/index.html   standalone page: open locally or serve with GitHub Pages
"""
import pathlib

root = pathlib.Path(__file__).parent
tpl = (root / 'src/index.html').read_text(encoding='utf-8')
body = (tpl.replace('/*ENGINE*/', (root / 'src/engine.js').read_text(encoding='utf-8'))
           .replace('/*UI*/', (root / 'src/ui.js').read_text(encoding='utf-8')))
(root / 'dist').mkdir(exist_ok=True)
(root / 'dist/woerth.html').write_text(body, encoding='utf-8')

head = ('<!doctype html><html lang="en"><head><meta charset="utf-8">'
        '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">'
        '<style>:root{padding-top:env(safe-area-inset-top);padding-bottom:env(safe-area-inset-bottom)}'
        'body{margin:0}img{max-width:100%}[hidden]{display:none!important}</style></head><body>')
(root / 'dist/index.html').write_text(head + body + '</body></html>', encoding='utf-8')
print(f'{len(body):,} bytes → dist/woerth.html, dist/index.html')
