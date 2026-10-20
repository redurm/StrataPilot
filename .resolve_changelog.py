import sys, re
p = sys.argv[1]
s = open(p, encoding='utf-8', newline='').read()
nl = '\r\n' if '\r\n' in s else '\n'
# keep both sides: the changelog is append-only per PR, a conflict there is never a real conflict
s = re.sub(r'^<{7}.*\r?\n', '', s, flags=re.M)
s = re.sub(r'^={7}\r?\n', '', s, flags=re.M)
s = re.sub(r'^>{7}.*\r?\n', '', s, flags=re.M)
# collapse a duplicated heading that the merge produced (### Fixed followed by another ### Fixed
# with no other heading in between)
lines = s.split(nl)
out = []
seen_headings = set()
for line in lines:
    m = re.match(r'^(#{2,4}) (.+)$', line.strip())
    if m:
        key = (m.group(1), m.group(2))
        if key in seen_headings:
            continue
        if m.group(1) in ('##', '###'):
            seen_headings = {key} if m.group(1) == '##' else seen_headings | {key}
        else:
            seen_headings.add(key)
    out.append(line)
s = nl.join(out)
open(p, 'w', encoding='utf-8', newline='').write(s)
print('resolved', p)
