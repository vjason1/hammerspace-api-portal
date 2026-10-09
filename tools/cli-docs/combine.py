# Combine cli_docs_<release>.json files into public/cli-docs.js
import json, os, glob
HERE=os.path.dirname(os.path.abspath(__file__)); ROOT=os.path.abspath(os.path.join(HERE,'..','..'))
by={}
for f in sorted(glob.glob(os.path.join(HERE,'cli_docs_*.json'))):
    d=json.load(open(f)); by[d['version']]=d
open(os.path.join(ROOT,'public','cli-docs.js'),'w').write(
 "/* Generated from the Hammerspace Command Line Reference and each release's CLI built-in help: CLI commands, their options,\n"
 " * and how they map to API operations and fields — one data set per release. Regenerate with tools/cli-docs (see its README). */\n"
 "'use strict';\nconst CLI_DOCS_BY_VERSION = "+json.dumps(by,ensure_ascii=False,separators=(',',':'))+";\n")
print('releases:', ', '.join(f"{k} ({len(v['commands'])} commands)" for k,v in by.items()))
