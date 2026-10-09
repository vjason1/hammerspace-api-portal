# Parse the output of the CLI's built-in help for every command ("Usage: <cmd> [options]" blocks)
# Usage: python3 parse_help.py clihelp.txt [5.3]   -> cli_help_<release>.json (cli_help.json when no release given)
import re, json, sys, os
HERE = os.path.dirname(os.path.abspath(__file__))
text = open(sys.argv[1] if len(sys.argv) > 1 else 'clihelp.txt', encoding='utf-8', errors='replace').read()
blocks = re.split(r'^Usage: ', text, flags=re.M)[1:]
cmds = {}
for b in blocks:
    lines = b.split('\n')
    name = lines[0].split()[0]
    body = lines[1:]
    try: oi = next(i for i, l in enumerate(body) if re.match(r'^\s*Options:\s*$', l))
    except StopIteration: oi = len(body)
    summary = ' '.join(l.strip() for l in body[:oi] if l.strip())
    opts, req, cur, col = {}, [], None, None
    for l in body[oi + 1:]:
        m = re.match(r'^(\s*)(\*\s+)?(--[A-Za-z0-9][\w-]*)(\s+)(.*)$', l)
        if m and len(m.group(1)) <= 4:
            cur = m.group(3)[2:]
            col = len(m.group(1)) + len(m.group(2) or '') + len(m.group(3)) + len(m.group(4))
            opts[cur] = m.group(5).strip()
            if m.group(2): req.append(cur)
        elif cur and l.strip():
            opts[cur] += ('\n' if opts[cur] else '') + l.strip()
    opts.pop('help', None)
    cmds[name] = {'summary': summary, 'options': opts, 'required': req}
out = f'cli_help_{sys.argv[2]}.json' if len(sys.argv) > 2 else 'cli_help.json'
json.dump(cmds, open(os.path.join(HERE, out), 'w'), indent=1)
print(len(cmds), 'commands')
