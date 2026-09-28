# Inlines companies.js into app.html -> ../markt-radar.html (single-file artifact).
import pathlib, sys
here = pathlib.Path(__file__).parent
html = (here / 'app.html').read_text()
data = (here / 'companies.js').read_text()
assert '/*__DATA__*/' in html
out = html.replace('/*__DATA__*/', data)
targets = [here.parent / 'markt-radar.html'] + [pathlib.Path(p) for p in sys.argv[1:]]
for t in targets:
    t.write_text(out)
    print('wrote', t, len(out), 'bytes')
