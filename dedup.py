import json

with open('schedule.json', 'r', encoding='utf-8') as f:
    data = json.load(f)

print(f"Before dedup: {len(data)} entries")

# 중복 제거: member + date + title 조합으로 유니크하게
seen = set()
deduped = []
for s in sorted(data, key=lambda x: (x['date'], x.get('member',''), x.get('time',''))):
    key = (s.get('member',''), s['date'], s.get('time','미정'), s.get('title','')[:30])
    if key not in seen:
        seen.add(key)
        deduped.append(s)

print(f"After dedup:  {len(deduped)} entries")

with open('schedule.json', 'w', encoding='utf-8') as f:
    json.dump(deduped, f, ensure_ascii=False, indent=2)

from collections import Counter
counts = Counter(s.get('member','?') for s in deduped)
for k, v in sorted(counts.items()):
    print(f"  {k}: {v}")
