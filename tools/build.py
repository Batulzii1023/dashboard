#!/usr/bin/env python3
"""design/*.dc.html -> docs/ (GitHub Pages). Ажиллуулах: python3 tools/build.py"""
import pathlib, re, shutil

ROOT = pathlib.Path(__file__).resolve().parent.parent
SRC, OUT = ROOT / "design", ROOT / "docs"

OUT.mkdir(exist_ok=True)
shutil.copy(ROOT / "tools" / "dc-lite.js", OUT / "dc-lite.js")
(OUT / ".nojekyll").write_text("")

for f in sorted(SRC.glob("*.dc.html")):
    s = f.read_text(encoding="utf-8")
    s = s.replace('<script src="./support.js"></script>',
                  '<style>body{margin:0;background:#0B1117}</style>\n'
                  '<script src="./dc-lite.js" defer></script>')
    s = s.replace("<x-dc>", '<template id="dc-root">').replace("</x-dc>", "</template>")
    s = re.sub(r"<sc-(for|if)\b", r'<template data-sc="\1"', s)
    s = re.sub(r"</sc-(for|if)>", "</template>", s)
    (OUT / f.name).write_text(s, encoding="utf-8")
    print("built", f.name)

shutil.copy(OUT / "Main.dc.html", OUT / "index.html")
print("built index.html")
