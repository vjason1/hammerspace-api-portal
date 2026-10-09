# Usage: pdftotext -layout <Command-Line-Reference.pdf> ref.txt && python3 parse.py ref.txt
import re, json, sys, os
HERE=os.path.dirname(os.path.abspath(__file__))
lines=open(sys.argv[1] if len(sys.argv)>1 else 'ref.txt').read().split('\n')
# drop page header/footer lines
clean=[]
for l in lines:
    if re.search(r'©\s*2026 - Hammerspace', l) or re.match(r'^\s*Hammerspace Command Line Reference\s*$', l): continue
    clean.append(l.rstrip())
text='\n'.join(clean)
# body starts at "Chapter 2"
body=text[text.index('Chapter 2. Share Management'):]
# split by command headers "N.N. cmd-name" followed by "  cmd-name [options]"
pat=re.compile(r'^(\d+\.\d+)\. ([a-z0-9][a-z0-9-]+)\n\s+\2\b[^\n]*\n', re.M)
ms=list(pat.finditer(body))
cmds={}; chapters={}
chap_pat=re.compile(r'^Chapter \d+\. (.+)$', re.M)
for i,m in enumerate(ms):
    seg=body[m.end(): ms[i+1].start() if i+1<len(ms) else len(body)]
    # chapter for this command
    prev=[c for c in chap_pat.finditer(body[:m.start()])]
    chap=prev[-1].group(1).strip() if prev else ''
    seg=chap_pat.split(seg)[0]
    parts=re.split(r'^\s*Options\s*$', seg, maxsplit=1, flags=re.M)
    desc=' '.join(parts[0].split())
    opts={}
    if len(parts)>1:
        chunks=re.split(r'^\s{1,4}(--[a-z0-9][a-z0-9-]*)\s*$', parts[1], flags=re.M)
        for j in range(1,len(chunks),2):
            d=' '.join(chunks[j+1].split())
            # fix hyphen line-breaks like "--new -name"
            d=re.sub(r'--([a-z0-9-]+) -([a-z])', r'--\1-\2', d)
            d=re.sub(r'(\w)- (\w)', r'\1-\2', d) if False else d
            opts[chunks[j][2:]]=d
    opts.pop('help',None)
    cmds[m.group(2)]={'chapter':chap,'summary':desc,'options':opts}
print(len(cmds))
json.dump(cmds,open(os.path.join(HERE,'cli.json'),'w'),indent=1)
import collections
print(collections.Counter(c['chapter'] for c in cmds.values()))
