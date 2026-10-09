# Compare two swagger.json files (older release vs the bundled newer one) and print what to put in
# public/versions.js for the older release: operations and body fields the older release doesn't have.
# Usage: python3 diff_specs.py swagger-5.2.json ../../public/swagger.json
import json, re, sys
old, new = (json.load(open(f)) for f in sys.argv[1:3])
def ops(s): return {(m.upper(), p) for p, it in s['paths'].items() for m in ('get', 'post', 'put', 'delete', 'patch') if m in it}
def props(s, n, seen=()):
    d = s['definitions'].get(n, {}); out = set(d.get('properties', {}))
    for a in d.get('allOf', []):
        if '$ref' in a and n not in seen: out |= props(s, a['$ref'].split('/')[-1], seen + (n,))
        out |= set(a.get('properties', {}))
    return out
print('      missingOps: [')
for m, p in sorted(ops(new) - ops(old), key=lambda x: x[1]):
    rx = '^' + re.sub(r'\\\{[^}]+\\\}', r'\\{[^}]+\\}', re.escape(p)).replace('/', '\\/') + '$'
    print(f"        r('{m}', /{rx}/),")
print('      ],\n      missingFields: [')
for n in sorted(set(new['definitions']) & set(old['definitions'])):
    for f in sorted(props(new, n) - props(old, n)): print(f"        '{n}.{f}',")
print('      ],\n      missingParams: [')
for m, p in sorted(ops(new) & ops(old), key=lambda x: x[1]):
    pn = {q['name'] for q in new['paths'][p][m.lower()].get('parameters', []) if q.get('in') != 'body'}
    po = {q['name'] for q in old['paths'][p][m.lower()].get('parameters', []) if q.get('in') != 'body'}
    for q in sorted(pn - po): print(f"        '{m.lower()}:{p}:{q}',")
print('      ],')
gone = ops(old) - ops(new)
if gone: print('\n// Only in the older release (not in the bundled spec):', ', '.join(f'{m} {p}' for m, p in sorted(gone)))
