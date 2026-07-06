import os
import re
import csv
import json
import urllib.request
import urllib.error
import io
import sys
from datetime import datetime, timedelta
from bs4 import BeautifulSoup

# Ensure stdout uses UTF-8 to prevent encoding crashes on Windows console when printing emojis
sys.stdout.reconfigure(encoding='utf-8')

# ── Configuration ─────────────────────────────────────────────────────────────
CONFIG_PATH   = "config.json"
SCHEDULE_PATH = "schedule.json"
DATA_JS_PATH  = "data.js"
NOW = datetime.now()

with open(CONFIG_PATH, "r", encoding="utf-8") as f:
    config = json.load(f)

CREW_LINKS = config["crewLinks"]
MEMBERS    = config["members"]  # dict of all members

# ── Google Sheet ───────────────────────────────────────────────────────────────
SHEET_URL = ("https://docs.google.com/spreadsheets/d/"
             "1MACuk1o089VAgMR43F46SXQkUwjQmEy6yZ4UDBJC8xk"
             "/export?format=csv&gid=1421214785")

# Other member emojis (used to exclude other members' schedule lines)
ALL_EMOJIS = {"🐷","❄️","💛","💜","🍒","🍑","💫","💙","🩵"}

def remove_time_patterns(text):
    if not text:
        return ""
    # 1. Match patterns like "오전/오후/새벽/밤/낮 12시 30분", "오후 7시", "19시 30분", "19:00", "19시", etc.
    cleaned = re.sub(r'(오전|오후|새벽|밤|낮)?\s*\d{1,2}\s*시(?!간)\s*(\d{1,2}\s*분)?', '', text)
    cleaned = re.sub(r'\d{1,2}:\d{2}', '', cleaned)
    
    # 2. Clean up leftover separators, trailing/leading spaces and hyphens/slashes
    cleaned = re.sub(r'\s*-\s*', ' ', cleaned)
    cleaned = re.sub(r'\s*/\s*', ' ', cleaned)
    cleaned = re.sub(r'\s*~\s*', ' ', cleaned)
    
    # Clean up trailing conjunctions and symbols left over after stripping time
    cleaned = re.sub(r'\s*\b(or|또는|혹은|and|&)\b\s*$', '', cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r'[\s~/\\\-&,]+$', '', cleaned).strip()
    cleaned = re.sub(r'^[\s~/\\\-&,]+', '', cleaned).strip()
    
    cleaned = re.sub(r'\s+', ' ', cleaned).strip()
    return cleaned

def is_generic_title(text):
    if not text:
        return True
    cleaned = re.sub(r'[\s\W_]+', '', text)
    if not cleaned or cleaned.isdigit():
        return True
    
    generic_words = [
        "오늘", "오늘도", "공지", "공지사항", "뱅온", "미정", "방송", "일정", "스케줄", "스케쥴",
        "생방", "켰어", "켰어요", "켬", "켜요", "올게", "올께", "오겠음", "오겠습니다", "올게요",
        "올께요", "있다봐요", "이따봐요", "이따봐", "이따봬요", "좀늦음", "늦음", "늦잠", "봬요",
        "뵈요", "봐요", "오겠", "올게", "뱅온함", "뱅온해요", "오겠슴다", "오겠습니당", "오겟습니다",
        "오겟슴다", "올겡", "올겟", "올겠", "올게용", "올께용", "켜서", "키겠", "키겟", "켭니다",
        "킬꺼", "켜고", "킬거", "올겡", "시작", "공지사항"
    ]
    temp = cleaned
    for gw in sorted(generic_words, key=len, reverse=True):
        temp = temp.replace(gw, "")
    
    temp_clean = re.sub(r'[\d\W_]+', '', temp)
    if not temp_clean:
        return True
    return False

def fetch_google_sheet():
    print("Fetching Google Sheet...")
    try:
        resp = urllib.request.urlopen(SHEET_URL, timeout=10)
        return resp.read().decode("utf-8")
    except Exception as e:
        print(f"  Sheet fetch failed: {e}")
        return None

def parse_google_sheet(csv_data, member_key):
    """Parse the Google Sheet for a specific member's events + crew-wide events."""
    if not csv_data:
        return []

    member = MEMBERS[member_key]
    member_emoji = member["emoji"]
    member_name  = member["name"]
    other_emojis = ALL_EMOJIS - {member_emoji}

    reader = list(csv.reader(io.StringIO(csv_data)))
    if not reader:
        return []

    year, month = NOW.year, NOW.month
    try:
        m = re.search(r"(\d{4})\s*/\s*(\d+)월", reader[0][2] if len(reader[0]) > 2 else "")
        if m:
            year, month = int(m.group(1)), int(m.group(2))
    except Exception:
        pass

    schedules = []
    i = 1
    while i < len(reader) - 2:
        date_row  = reader[i]
        day_row   = reader[i+1]
        sched_row = reader[i+2]

        if not any(d in day_row for d in ["월","화","수","목","금","토","일"]):
            i += 1
            continue

        for col in range(len(date_row)):
            dv = date_row[col].strip()
            if not dv or not dv.isdigit():
                continue
            day_val   = day_row[col].strip()   if col < len(day_row)   else ""
            sched_val = sched_row[col].strip() if col < len(sched_row) else ""
            try:
                date_obj = datetime(year, month, int(dv))
                date_str = date_obj.strftime("%Y-%m-%d")
            except ValueError:
                continue

            for line in sched_val.split("\n"):
                line = line.strip()
                if not line:
                    continue
                # Nickname matching
                nicks = ["아뚱", "뚱대장", "뚱때장", "뚱대", "대장"] if member_key == "adeung" else \
                        ["유키"] if member_key == "yuki" else \
                        ["꼼모리", "모리"] if member_key == "ggommori" else \
                        ["니니밍", "뉴미밍", "니미밍"] if member_key == "niniming" else \
                        ["호미밍", "미밍"] if member_key == "homiming" else \
                        ["피치"] if member_key == "peach" else \
                        ["마리별", "리별"] if member_key == "maribyeol" else \
                        ["너보링", "보링"] if member_key == "neboring" else \
                        ["헤다"] if member_key == "heda" else [member_name]
                is_member = member_emoji in line or any(nick in line for nick in nicks)
                is_crew   = ("뚱딴지" in line
                             and not any(e in line for e in other_emojis)
                             and not is_member)
                if is_member or is_crew:
                    tm = extract_time(line)
                    line_clean = remove_time_patterns(line)
                    clean_word = re.sub(r'[\s\W_]+', '', line_clean)
                    if not clean_word or clean_word.isdigit() or line_clean in ["뱅온", "공지", "미정"]:
                        line_clean = "미정"
                    title = ("[크루] " if is_crew else "") + line_clean
                    schedules.append({
                        "member":  member_key,
                        "date":    date_str,
                        "day":     day_val,
                        "time":    tm,
                        "title":   title,
                        "note":    "구글 시트 일정표 기준",
                        "source":  "google_sheet"
                    })
        i += 3

    return schedules

def fetch_personal_sheet(url):
    try:
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
        resp = urllib.request.urlopen(req, timeout=10)
        return resp.read().decode("utf-8")
    except Exception as e:
        print(f"  Personal sheet fetch failed: {e}")
        return None

def parse_monthly_grid_sheet(csv_data, member_key):
    """Parse a monthly calendar grid sheet. Auto-detects column layout and year/month."""
    if not csv_data:
        return []

    reader = list(csv.reader(io.StringIO(csv_data)))
    if not reader:
        return []

    year, month = NOW.year, NOW.month
    day_names_sun = ["일", "월", "화", "수", "목", "금", "토"]

    # --- Auto-detect year/month from early rows ---
    year_detected = False
    month_detected = False
    for row in reader[:4]:
        row_text = " ".join(row)
        if not year_detected:
            ym = re.search(r"(\d{4})\s*년", row_text)
            if ym:
                year = int(ym.group(1))
                year_detected = True
        if not month_detected:
            mm = re.search(r"(\d{1,2})\s*월", row_text)
            if mm:
                month = int(mm.group(1))
                month_detected = True

    # --- Auto-detect column range by finding the day-name header row ---
    col_start, col_end = None, None
    for row in reader[:10]:
        for c in range(len(row)):
            val = row[c].strip()
            if val in ("일", "SUNDAY", "SUN"):
                # Check if this is a header row with consecutive day names
                if c + 6 < len(row):
                    col_start = c
                    col_end = c + 7  # exclusive
                    break
        if col_start is not None:
            break

    if col_start is None:
        # Fallback: try columns 4-10 (Yuki) then 1-7 (Niniming)
        col_start, col_end = 4, 11

    schedules = []
    row_idx = 0
    while row_idx < len(reader):
        row = reader[row_idx]
        if len(row) > col_start:
            # Check if this row contains date numbers (possibly with text) in the calendar columns
            date_count = 0
            for col in range(col_start, min(col_end, len(row))):
                val = row[col].strip()
                m_day = re.match(r"^(\d{1,2})(?!\s*월)\b", val)
                if m_day:
                    day_num = int(m_day.group(1))
                    if 1 <= day_num <= 31:
                        date_count += 1
            
            if date_count >= 2:  # At least 2 date numbers to be a date row
                date_row = row
                
                # Collect all subsequent non-empty detail rows until next date row or gap
                detail_rows = []
                for offset in range(1, 7):
                    if row_idx + offset >= len(reader):
                        break
                    next_row = reader[row_idx + offset]
                    # Check if this next row is another date row
                    next_date_count = 0
                    for col in range(col_start, min(col_end, len(next_row))):
                        val = next_row[col].strip() if col < len(next_row) else ""
                        m_next = re.match(r"^(\d{1,2})(?!\s*월)\b", val)
                        if m_next:
                            next_date_count += 1
                    if next_date_count >= 2:
                        break
                    detail_rows.append(next_row)
                
                for col_idx in range(col_start, min(col_end, len(date_row))):
                    day_val = date_row[col_idx].strip()
                    m_day = re.match(r"^(\d{1,2})(?!\s*월)\b(.*)", day_val, re.DOTALL)
                    if not m_day:
                        continue
                    
                    day_num = int(m_day.group(1))
                    cell_text = m_day.group(2).strip()
                    if day_num < 1 or day_num > 31:
                        continue
                    
                    # Handle month overflow (e.g. "31" in September grid = Aug 31)
                    try:
                        date_obj = datetime(year, month, day_num)
                    except ValueError:
                        continue
                    
                    date_str = date_obj.strftime("%Y-%m-%d")
                    day_name = day_names_sun[col_idx - col_start]
                    
                    # Collect all non-empty detail cells for this column
                    details = []
                    if cell_text:
                        details.append(cell_text)
                    for d_row in detail_rows:
                        if col_idx < len(d_row):
                            val = d_row[col_idx].strip()
                            if val:
                                details.append(val)
                    
                    if not details:
                        continue  # No schedule info for this date
                    
                    # Check for 휴방/휴뱅 in any detail
                    all_text = " ".join(details)
                    if "휴방" in all_text or ("휴뱅" in all_text and len(details) == 1):
                        rest = [d for d in details if "휴방" not in d and "휴뱅" not in d]
                        schedules.append({
                            "member": member_key,
                            "date": date_str,
                            "day": day_name,
                            "time": "미정",
                            "title": "휴방",
                            "note": " / ".join(rest) if rest else "휴방",
                            "source": "google_sheet"
                        })
                        continue
                    
                    # Extract time from status or content
                    time_str = "미정"
                    for d in details:
                        extracted = extract_time(d)
                        if extracted != "미정":
                            time_str = extracted
                            break
                    
                    # Content details: exclude lines containing status indicators like "뱅온", "휴뱅", "휴방"
                    real_content = [d for d in details if not ("뱅온" in d or "휴뱅" in d or "휴방" in d)]
                    
                    if real_content:
                        # Clean up prefixes like emojis and redundant spaces
                        real_content = [re.sub(r"^🔔\s*", "", p).strip() for p in real_content]
                        # Strip time patterns from each content item
                        real_content = [remove_time_patterns(p) for p in real_content]
                        real_content = [p for p in real_content if p]
                        
                        # Build title from all cleaned content details joined by ' / '
                        cleaned_title = " / ".join(real_content) if real_content else "미정"
                    else:
                        cleaned_title = "미정"
                        
                    clean_word = re.sub(r'[\s\W_]+', '', cleaned_title)
                    if not clean_word or clean_word.isdigit() or cleaned_title in ["뱅온", "공지", "미정"]:
                        cleaned_title = "미정"

                    schedules.append({
                        "member": member_key,
                        "date": date_str,
                        "day": day_name,
                        "time": time_str,
                        "title": cleaned_title,
                        "note": "구글 시트 일정표 기준",
                        "source": "google_sheet"
                    })
                
                row_idx += len(detail_rows) + 1
                continue
        row_idx += 1
        
    return schedules

# ── Selenium HTML Fetcher ──────────────────────────────────────────────────────
def fetch_html_selenium(url):
    """Fetch any page using Selenium headless Chrome and return HTML."""
    from selenium import webdriver
    from selenium.webdriver.chrome.options import Options
    import time

    opts = Options()
    opts.add_argument("--headless")
    opts.add_argument("--no-sandbox")
    opts.add_argument("--disable-dev-shm-usage")
    try:
        d = webdriver.Chrome(options=opts)
        d.get(url)
        time.sleep(5)
        html = d.page_source
        d.quit()
        return html
    except Exception as e:
        print(f"  Selenium failed for {url}: {e}")
        try: d.quit()
        except: pass
        return None

def parse_relative_date(text):
    text = text.strip()
    if "시간 전" in text:
        h = int(re.search(r"(\d+)시간", text).group(1))
        return (NOW - timedelta(hours=h)).strftime("%Y-%m-%d")
    if "분 전" in text:
        m = int(re.search(r"(\d+)분", text).group(1))
        return (NOW - timedelta(minutes=m)).strftime("%Y-%m-%d")
    if "일 전" in text:
        d = int(re.search(r"(\d+)일", text).group(1))
        return (NOW - timedelta(days=d)).strftime("%Y-%m-%d")
    if "어제" in text:
        return (NOW - timedelta(days=1)).strftime("%Y-%m-%d")
    m = re.search(r"(\d{4}-\d{2}-\d{2})", text)
    if m:
        return m.group(1)
    return None
def refine_schedule_title(title, body):
    full_text = (title + " " + body).strip()
    
    # 1. Check if it's a rest day (휴방 / 휴뱅 / 휴빵)
    if any(h in full_text for h in ["휴방", "휴뱅", "휴빵", "쉬어", "쉬고", "쉬겠", "쉽니다", "쉬다"]):
        return "휴방"

    # 2. Extract Time
    times = extract_all_times(full_text)
    best_t = get_best_time(times)
    time_str = ""
    if best_t:
        h = best_t["hour"]
        m = best_t["minute"]
        if m > 0:
            time_str = f"{h}시 {m}분"
        else:
            time_str = f"{h}시"

    # 3. Extract core content/activities
    activities = []
    
    sentences = re.split(r'[!\.\n\?\~\|/]', full_text)
    for s in sentences:
        s = s.strip()
        if not s or "어제" in s or "저번" in s:
            continue
            
        s_clean = re.sub(r'[\U00010000-\U0010ffff]', '', s) # Remove emoji
        s_clean = re.sub(r'(?:이따|나중에|오늘|갑자기|최대한|빨리|쪼끔|조금만|더|제발|진짜)\s*', '', s_clean)
        
        if "드래프트" in s_clean:
            activities.append("중간계 드래프트 보기")
        elif "철권" in s_clean:
            activities.append("철권")
        elif "배그" in s_clean or "배틀그라운드" in s_clean:
            activities.append("배그")
        elif "마크" in s_clean or "마인크래프트" in s_clean:
            activities.append("마크")
        elif "롤" in s_clean or "리그오브" in s_clean:
            activities.append("롤")
        elif "발로" in s_clean:
            activities.append("발로란트")
        elif "공겜" in s_clean or "공포게임" in s_clean:
            activities.append("공포게임")
        elif "종겜" in s_clean or "종합게임" in s_clean:
            activities.append("종합게임")
        elif "점호" in s_clean:
            activities.append("뚱딴지 점호")
        elif "익명카톡" in s_clean:
            activities.append("익명 카톡")
        elif "싱크룸" in s_clean or "노래" in s_clean:
            activities.append("노래 방송")
        elif "합방" in s_clean:
            m = re.search(r'(\w+\s*(?:합방|대결))', s_clean)
            if m:
                activities.append(m.group(1).strip())
            else:
                activities.append("합방")
        elif "LPL" in s_clean or "중계" in s_clean:
            if "결승" in s_clean:
                activities.append("LPL 결승 중계")
            elif "준결승" in s_clean:
                activities.append("LPL 준결승 중계")
            else:
                activities.append("중계")
        elif "컨텐츠" in s_clean or "콘텐츠" in s_clean:
            m = re.search(r'(\w+\s*(?:컨텐츠|콘텐츠))', s_clean)
            if m:
                activities.append(m.group(1).strip())
            else:
                activities.append("컨텐츠")
        elif "대결" in s_clean or "종겜대결" in s_clean:
            activities.append("대결")
        elif "소통" in s_clean or "노가리" in s_clean or "토크" in s_clean:
            activities.append("소통")
            
    # Deduplicate activities
    unique_activities = []
    for act in activities:
        if act not in unique_activities:
            unique_activities.append(act)

    if unique_activities:
        final_title = " / ".join(unique_activities[:2])
    else:
        final_title = "미정"
    
    if not final_title or final_title == "미정":
        clean_raw = re.sub(r'[\U00010000-\U0010ffff]', '', title).strip()
        clean_raw = remove_time_patterns(clean_raw)
        if clean_raw and not is_generic_title(clean_raw):
            return clean_raw[:35] + "..." if len(clean_raw) > 35 else clean_raw
        else:
            return "미정"
        
    return final_title

def find_post_container(a):
    best_div = None
    for parent in a.parents:
        if parent.name in ["li", "tr"]:
            return parent
        if parent.name == "div":
            classes = parent.get("class", [])
            if any("post" in c.lower() or "item" in c.lower() for c in classes):
                best_div = parent
            all_links = parent.find_all("a", href=re.compile(r"/post/\d+"))
            post_ids = set()
            for l in all_links:
                m = re.search(r"/post/(\d+)", l["href"])
                if m:
                    post_ids.add(m.group(1))
            if len(post_ids) == 1:
                if not best_div:
                    best_div = parent
            else:
                break
    return best_div

def parse_soop_html(html, member_key):
    """Parse SOOP board HTML into list of notice dicts."""
    if not html:
        return []
    soup = BeautifulSoup(html, "html.parser")
    posts = []
    seen_posts = set()
    
    # Find all unique post links first
    all_post_links = soup.find_all("a", href=re.compile(r"/post/\d+"))
    for a in all_post_links:
        href = a["href"]
        post_id_match = re.search(r"/post/(\d+)", href)
        if not post_id_match:
            continue
        post_id = post_id_match.group(1)
        if post_id in seen_posts:
            continue
            
        container = find_post_container(a)
        if not container:
            continue
            
        parts = [p.strip() for p in container.get_text("|", strip=True).split("|") if p.strip()]
        if len(parts) < 3:
            continue
        date_str = None
        for p in reversed(parts):
            date_str = parse_relative_date(p)
            if date_str:
                break
        if date_str:
            title = a.get_text(strip=True)
            body = ""
            try:
                t_idx = parts.index(title)
                for next_p in parts[t_idx+1:]:
                    if not re.match(r'^\d+[\d,]*$', next_p) and not parse_relative_date(next_p) and next_p != title:
                        body = next_p
                        break
            except ValueError:
                if len(parts) > 3:
                    title = parts[3]
                    body = parts[4] if len(parts) > 4 else ""
            
            time_stems = ["뱅온", "올게", "올께", "오겠", "오겟", "오께", "킬게", "킬께", "켜서", "키겠", "키겟", "켭니다", "킬꺼", "켜고", "킬거", "올겡", "시작"]
            sched_stems = ["하겠", "하겟", "할거", "할꺼", "할게", "할겡", "봐요", "봬요", "뵈요", "보자", "보쟈", "보겟", "보겠", "휴뱅", "휴방", "휴빵", "일정", "스케줄", "스케쥴", "쉬어", "쉬고", "쉽니다", "쉬다", "쉬겠", "휴무", "방송"]
            all_kws = time_stems + sched_stems
            
            content = (title + " " + body).lower().replace(" ", "")
            has_time = len(extract_all_times(title + " " + body)) > 0 or re.search(r'\d{1,2}\s*:\s*\d{2}', content)
            
            if has_time or any(kw in content for kw in all_kws):
                refined_title = refine_schedule_title(title, body)
                tm = extract_time(title + " " + body)
                posts.append({
                    "member": member_key,
                    "date":   date_str,
                    "title":  refined_title,
                    "body":   body,
                    "time":   tm,
                    "url":    "https://www.sooplive.com" + a["href"],
                    "source": "soop"
                })
                seen_posts.add(post_id)
    return posts

# ── Time parser ───────────────────────────────────────────────────────────────
def extract_all_times(text):
    times = []
    # Pattern A: (오전|오후|저녁|밤|아침|새벽)? \d시 \d분 (반)?
    pat_a = re.compile(r"(오전|오후|저녁|밤|아침|새벽)?\s*(\d{1,2})\s*시(?!간)(?:\s*(\d{1,2})\s*분)?(?:\s*(반))?")
    for m in pat_a.finditer(text):
        raw = m.group(0)
        ampm = m.group(1)
        h = int(m.group(2))
        minute = 0
        if m.group(3):
            minute = int(m.group(3))
        elif m.group(4):
            minute = 30
        
        is_pm = False
        is_am = False
        is_dawn = False
        if ampm:
            if ampm in ["오후", "저녁", "밤"]:
                is_pm = True
            elif ampm in ["오전", "아침"]:
                is_am = True
            elif ampm == "새벽":
                is_dawn = True
        
        post_text = text[m.end():m.end()+15].replace(" ", "")
        is_bangjong = any(w in post_text for w in ["방종", "종료", "퇴근", "끝", "컷"])
        
        times.append({
            "hour": h,
            "minute": minute,
            "ampm": ampm,
            "is_pm": is_pm,
            "is_am": is_am,
            "is_dawn": is_dawn,
            "is_bangjong": is_bangjong,
            "raw": raw,
            "start": m.start(),
            "end": m.end()
        })
        
    # Pattern B: \d{1,2}:\d{2}
    pat_b = re.compile(r"(\d{1,2})\s*:\s*(\d{2})")
    for m in pat_b.finditer(text):
        start, end = m.start(), m.end()
        if any(t["start"] <= start < t["end"] or t["start"] < end <= t["end"] for t in times):
            continue
        h = int(m.group(1))
        minute = int(m.group(2))
        
        pre_text = text[max(0, start-10):start].replace(" ", "")
        is_pm = any(w in pre_text for w in ["오후", "저녁", "밤"])
        is_am = any(w in pre_text for w in ["오전", "아침"])
        is_dawn = any(w in pre_text for w in ["새벽"])
        
        ampm = None
        if is_pm: ampm = "오후"
        elif is_am: ampm = "오전"
        elif is_dawn: ampm = "새벽"
        
        post_text = text[end:end+15].replace(" ", "")
        is_bangjong = any(w in post_text for w in ["방종", "종료", "퇴근", "끝", "컷"])
        
        times.append({
            "hour": h,
            "minute": minute,
            "ampm": ampm,
            "is_pm": is_pm,
            "is_am": is_am,
            "is_dawn": is_dawn,
            "is_bangjong": is_bangjong,
            "raw": m.group(0),
            "start": start,
            "end": end
        })
        
    times.sort(key=lambda x: x["start"])
    return times

def get_best_time(times):
    if not times:
        return None
    for t in reversed(times):
        if not t["is_bangjong"]:
            return t
    return times[-1]

def format_time_info(t_info):
    h = t_info["hour"]
    m = t_info["minute"]
    ampm = t_info["ampm"]
    is_pm = t_info["is_pm"]
    is_am = t_info["is_am"]
    is_dawn = t_info["is_dawn"]
    
    if h == 12:
        if is_am or is_dawn or (ampm and ampm in ["밤", "저녁"]):
            h = 0
        else:
            h = 12
    else:
        if not is_pm and not is_am and not is_dawn:
            if 1 <= h <= 11:
                h += 12
        elif is_pm and h < 12:
            h += 12
    return f"{h:02d}:{m:02d}"

def extract_time(text):
    times = extract_all_times(text)
    best_t = get_best_time(times)
    if not best_t:
        return "미정"
    return format_time_info(best_t)

# ── Naver Cafe Scraping ────────────────────────────────────────────────────────
def normalize_naver_cafe_url(url):
    if not url:
        return url
    if "m.cafe.naver.com" in url:
        return url
        
    m = re.search(r"cafe\.naver\.com/[^/]+/cafes/(\d+)/menus/(\d+)", url, re.IGNORECASE)
    if m:
        club_id, menu_id = m.group(1), m.group(2)
        return f"https://m.cafe.naver.com/ca-fe/web/cafes/{club_id}/menus/{menu_id}"
        
    if "ArticleList.nhn" in url or "ArticleRead.nhn" in url or "ArticleList" in url:
        club_match = re.search(r"search\.clubid=(\d+)", url, re.IGNORECASE)
        menu_match = re.search(r"search\.menuid=(\d+)", url, re.IGNORECASE)
        if club_match and menu_match:
            club_id = club_match.group(1)
            menu_id = menu_match.group(1)
            return f"https://m.cafe.naver.com/ca-fe/web/cafes/{club_id}/menus/{menu_id}"

    m2 = re.search(r"cafe\.naver\.com/ca-fe/cafes/(\d+)/menus/(\d+)", url, re.IGNORECASE)
    if m2:
        club_id, menu_id = m2.group(1), m2.group(2)
        return f"https://m.cafe.naver.com/ca-fe/web/cafes/{club_id}/menus/{menu_id}"
        
    return url

def parse_cafe_html(html, member_key):
    if not html:
        return []
    soup = BeautifulSoup(html, "html.parser")
    posts = []
    seen_urls = set()
    
    # Naver Cafe mobile links class is usually 'mainLink' or they contain 'ArticleRead.nhn'
    for a in soup.find_all("a"):
        href = a.get("href", "")
        classes = a.get("class", [])
        if "mainLink" in classes or "ArticleRead.nhn" in href:
            if href in seen_urls:
                continue
            text = a.get_text(strip=True)
            if not text:
                continue
                
            # Date pattern: YY.MM.DD
            m = re.search(r"(\d{2})\.(\d{2})\.(\d{2})", text)
            if not m:
                continue
                
            yy, mm, dd = m.group(1), m.group(2), m.group(3)
            date_str = f"20{yy}-{mm}-{dd}"
            
            # Title is the text before author name/date or just the main content.
            date_index = text.find(f"{yy}.{mm}.{dd}")
            if date_index != -1:
                title_part = text[:date_index].strip()
            else:
                title_part = text.strip()
                
            # Remove member name from title if it ends with it (e.g. "호미밍")
            member_name = MEMBERS[member_key]["name"]
            if title_part.endswith(member_name):
                title_part = title_part[:-len(member_name)].strip()
            
            # Remove leading "공지"
            if title_part.startswith("공지"):
                title_part = title_part[2:].strip()
                
            # Check for rest day
            if any(h in title_part for h in ["휴방", "휴뱅", "휴빵", "쉬어", "쉬고", "쉬겠", "쉽니다", "쉬다"]):
                title = "휴방"
                tm = "미정"
            else:
                tm = extract_time(title_part)
                title = remove_time_patterns(title_part)
                if not title or title in ["뱅온", "공지", "미정"]:
                    title = "미정"
                    
            # Full URL
            full_url = href
            if href.startswith("/"):
                full_url = "https://m.cafe.naver.com" + href
                
            posts.append({
                "member": member_key,
                "date": date_str,
                "day": "", # will be populated in merge
                "time": tm,
                "title": title,
                "note": "네이버 카페 공지 기준",
                "source": "naver_cafe",
                "url": full_url
            })
            seen_urls.add(href)
            
    return posts

def extract_latest_cafe_article_info(html, member_key):
    soup = BeautifulSoup(html, "html.parser")
    for a in soup.find_all("a"):
        href = a.get("href", "")
        classes = a.get("class", [])
        if "mainLink" in classes or "ArticleRead.nhn" in href:
            text = a.get_text(strip=True)
            m = re.search(r"(\d{2})\.(\d{2})\.(\d{2})", text)
            if m:
                yy, mm, dd = m.group(1), m.group(2), m.group(3)
                post_date = f"20{yy}-{mm}-{dd}"
                date_idx = text.find(f"{yy}.{mm}.{dd}")
                title = text[:date_idx].strip() if date_idx != -1 else text.strip()
                if title.endswith("호미밍"):
                    title = title[:-3].strip()
                if title.startswith("공지"):
                    title = title[2:].strip()
                
                # Check for schedule keywords
                if not any(kw in title for kw in ["일정", "스케줄", "스케쥴", "시간표"]):
                    continue
                    
                full_url = href
                if href.startswith("/"):
                    full_url = "https://m.cafe.naver.com" + href
                return {
                    "url": full_url,
                    "title": title,
                    "date": post_date
                }
    return None

def download_cafe_image(url, dest_path):
    try:
        base_url = url.split("?")[0]
        # Try different formats/qualities of Naver images
        for quality in ["?type=w1080", "?type=org", ""]:
            target_url = base_url + quality
            req = urllib.request.Request(target_url)
            req.add_header('User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36')
            req.add_header('Referer', 'https://cafe.naver.com/mingout')
            try:
                with urllib.request.urlopen(req, timeout=10) as resp:
                    data = resp.read()
                    if len(data) > 1000:
                        with open(dest_path, "wb") as f:
                            f.write(data)
                        print(f"  [Cafe Image] Downloaded image: {target_url}")
                        return True
            except Exception as e:
                print(f"  [Cafe Image] Download failed for {target_url}: {e}")
    except Exception as e:
        print(f"  [Cafe Image] Error downloading image: {e}")
    return False

def scrape_homiming_cafe_image_schedule(cafe_url, member_key):
    print(f"  [Cafe Image] Fetching Cafe menu: {cafe_url}")
    html = fetch_html_selenium(cafe_url)
    if not html:
        print(f"  [Cafe Image] Failed to fetch Cafe menu")
        return []
        
    # Step 1: Save cafe_source.html
    cafe_source_path = "scratch/cafe_source.html"
    os.makedirs("scratch", exist_ok=True)
    with open(cafe_source_path, "w", encoding="utf-8") as f:
        f.write(html)
    print(f"  [Cafe Image] Saved Cafe menu HTML to {cafe_source_path}")
    
    # Step 2: Extract latest article info
    article_info = extract_latest_cafe_article_info(html, member_key)
    if not article_info:
        print(f"  [Cafe Image] Failed to find schedule article link in menu")
        return []
        
    print(f"  [Cafe Image] Latest article: {article_info['title']} ({article_info['url']})")
    
    # Step 3: Fetch article page
    print(f"  [Cafe Image] Loading article page...")
    article_html = fetch_html_selenium(article_info["url"])
    if not article_html:
        print(f"  [Cafe Image] Failed to fetch article page")
        return []
        
    # Step 4: Extract schedule image URL
    soup = BeautifulSoup(article_html, "html.parser")
    image_url = None
    for img in soup.find_all("img"):
        src = img.get("src", "")
        data_lazy = img.get("data-lazy-src", "")
        actual_src = data_lazy if data_lazy else src
        if not actual_src:
            continue
        if any(domain in actual_src for domain in ["postfiles.pstatic.net", "post.phinf.naver.net", "cafeptthumb"]):
            image_url = actual_src
            break
            
    if not image_url:
        print(f"  [Cafe Image] Failed to find schedule image in article body")
        return []
        
    print(f"  [Cafe Image] Found schedule image URL: {image_url}")
    
    # Step 5: Download image
    image_path = "scratch/homiming_schedule.png"
    downloaded = download_cafe_image(image_url, image_path)
    
    # Step 6: Write metadata file
    metadata = {
        "member": member_key,
        "article_url": article_info["url"],
        "image_url": image_url,
        "article_title": article_info["title"],
        "post_date": article_info["date"]
    }
    metadata_path = "scratch/cafe_article_metadata.json"
    with open(metadata_path, "w", encoding="utf-8") as f:
        json.dump(metadata, f, ensure_ascii=False, indent=2)
        
    # Step 7: Parse using parse_cafe_articles.py
    try:
        import parse_cafe_articles
        parsed_scheds = parse_cafe_articles.parse_and_process()
        if parsed_scheds:
            return parsed_scheds
        else:
            raise Exception("Parser returned no schedules")
    except Exception as e:
        print(f"  [Cafe Image] OCR parsing failed, using fallback: {e}")
        try:
            import parse_cafe_articles
            return parse_cafe_articles.generate_fallback_schedules(member_key, article_info["url"], image_url, article_info["date"])
        except Exception as fallback_err:
            print(f"  [Cafe Image] Fallback generator failed: {fallback_err}")
            return []

# ── Merge all sources with priorities ──────────────────────────────────────────
def merge_member_sources(sheet_scheds, cafe_scheds, soop_scheds, member_key):
    day_map = {"Mon":"월","Tue":"화","Wed":"수","Thu":"목",
               "Fri":"금","Sat":"토","Sun":"일"}
    merged = {}
    
    all_items = []
    if sheet_scheds:
        for x in sheet_scheds:
            if "source" not in x: x["source"] = "google_sheet"
        all_items.extend(sheet_scheds)
    if cafe_scheds:
        for x in cafe_scheds:
            if "source" not in x: x["source"] = "naver_cafe"
        all_items.extend(cafe_scheds)
    if soop_scheds:
        for x in soop_scheds:
            if "source" not in x: x["source"] = "soop"
        all_items.extend(soop_scheds)
        
    for item in all_items:
        date = item["date"]
        merged.setdefault(date, []).append(item)
        
    flat = []
    for date, items in sorted(merged.items()):
        # Split items into crew and personal
        crew_items = [x for x in items if x["title"].startswith("[크루]")]
        personal_items = [x for x in items if not x["title"].startswith("[크루]")]
        
        # Keep all unique crew items
        unique_crew = []
        seen_crew = set()
        for x in crew_items:
            key = (x["title"], x.get("time", "미정"))
            if key not in seen_crew:
                seen_crew.add(key)
                unique_crew.append(x)
                
        # For personal items, apply priority rules:
        # Priority: 1. google_sheet, 2. naver_cafe, 3. soop
        selected_personal = []
        if personal_items:
            # Group personal items by source
            by_source = {}
            for x in personal_items:
                by_source.setdefault(x["source"], []).append(x)
                
            # Choose the highest priority source available
            if "google_sheet" in by_source:
                selected_personal = by_source["google_sheet"]
            elif "naver_cafe_image" in by_source:
                selected_personal = by_source["naver_cafe_image"]
            elif "naver_cafe" in by_source:
                selected_personal = by_source["naver_cafe"]
            elif "soop" in by_source:
                selected_personal = by_source["soop"]
                
        # Populate day name for all selected items
        day_kor = day_map.get(datetime.strptime(date, "%Y-%m-%d").strftime("%a"), "")
        for x in unique_crew + selected_personal:
            x["day"] = day_kor
            flat.append(x)
            
    return flat

# ── Cumulative save ────────────────────────────────────────────────────────────
# ── Supabase Integration ──────────────────────────────────────────────────────
SUPABASE_URL = (os.environ.get("SUPABASE_URL") or "").strip() or None
SUPABASE_ANON_KEY = (os.environ.get("SUPABASE_ANON_KEY") or "").strip() or None

def fetch_supabase_schedules():
    if not SUPABASE_URL or not SUPABASE_ANON_KEY:
        return None
    url = f"{SUPABASE_URL}/rest/v1/schedules?select=*"
    req = urllib.request.Request(
        url,
        headers={
            "apikey": SUPABASE_ANON_KEY,
            "Authorization": f"Bearer {SUPABASE_ANON_KEY}"
        }
    )
    try:
        with urllib.request.urlopen(req, timeout=10) as r:
            return json.loads(r.read().decode("utf-8"))
    except urllib.error.HTTPError as he:
        err_body = he.read().decode("utf-8")
        print(f"  [Supabase] Fetch failed with status {he.code}: {he.reason}")
        print(f"  [Supabase] Error details: {err_body}")
        return None
    except Exception as e:
        print(f"  [Supabase] Fetch failed: {e}")
        return None

def save_supabase_schedules(schedules):
    if not SUPABASE_URL or not SUPABASE_ANON_KEY:
        return False
    
    # 1. Clear existing schedules
    delete_url = f"{SUPABASE_URL}/rest/v1/schedules?id=not.is.null"
    delete_req = urllib.request.Request(
        delete_url,
        headers={
            "apikey": SUPABASE_ANON_KEY,
            "Authorization": f"Bearer {SUPABASE_ANON_KEY}"
        },
        method="DELETE"
    )
    try:
        with urllib.request.urlopen(delete_req, timeout=10) as r:
            pass
    except urllib.error.HTTPError as he:
        err_body = he.read().decode("utf-8")
        print(f"  [Supabase] Clear table failed with status {he.code}: {he.reason}")
        print(f"  [Supabase] Error details: {err_body}")
        return False
    except Exception as e:
        print(f"  [Supabase] Clear table failed: {e}")
        return False
        
    # 2. Insert schedules in bulk
    payload = []
    for s in schedules:
        payload.append({
            "member": s.get("member", ""),
            "date": s.get("date", ""),
            "day": s.get("day", ""),
            "time": s.get("time", "미정"),
            "title": s.get("title", ""),
            "note": s.get("note", ""),
            "source": s.get("source", "manual"),
            "url": s.get("url", "")
        })
        
    insert_url = f"{SUPABASE_URL}/rest/v1/schedules"
    insert_req = urllib.request.Request(
        insert_url,
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "apikey": SUPABASE_ANON_KEY,
            "Authorization": f"Bearer {SUPABASE_ANON_KEY}",
            "Content-Type": "application/json"
        },
        method="POST"
    )
    try:
        with urllib.request.urlopen(insert_req, timeout=10) as r:
            pass
        return True
    except urllib.error.HTTPError as he:
        err_body = he.read().decode("utf-8")
        print(f"  [Supabase] Insert failed with status {he.code}: {he.reason}")
        print(f"  [Supabase] Error details: {err_body}")
        return False
    except Exception as e:
        print(f"  [Supabase] Insert failed: {e}")
        return False

# ── Cumulative save ────────────────────────────────────────────────────────────
def cumulative_save(new_list, member_key):
    """Load existing schedules from Supabase or local schedule.json, replace entries for this member, keep others."""
    old_list = None
    if SUPABASE_URL and SUPABASE_ANON_KEY:
        print("  [Supabase] Loading schedules...")
        old_list = fetch_supabase_schedules()
        
    if old_list is None:
        old_list = []
        if os.path.exists(SCHEDULE_PATH):
            try:
                with open(SCHEDULE_PATH, "r", encoding="utf-8") as f:
                    old_list = json.load(f)
            except Exception:
                pass

    today_str = NOW.strftime("%Y-%m-%d")

    # Keep entries for OTHER members unchanged
    other_members = [s for s in old_list if s.get("member") != member_key]

    # For THIS member: keep past entries, manual overrides, and new scraped entries (not overridden by manual)
    this_manual = [s for s in old_list if s.get("member") == member_key and s.get("source") == "manual"]
    manual_dates = {s["date"] for s in this_manual}

    old_this_past = [s for s in old_list
                     if s.get("member") == member_key and s["date"] < today_str and s.get("source") != "manual"]
    new_this       = [s for s in new_list if s["date"] >= today_str and s["date"] not in manual_dates]

    # Also add any new past entries not already saved or override fallbacks
    dates_with_new_entries = {s["date"] for s in new_list}
    fallback_dates = set()
    for date in dates_with_new_entries:
        existing = [x for x in old_this_past if x["date"] == date]
        if existing and all("일정 확인 중" in x.get("title", "") for x in existing):
            fallback_dates.add(date)
            
    old_this_past = [x for x in old_this_past if not (x["date"] in fallback_dates and "일정 확인 중" in x.get("title", ""))]
    
    old_past_dates = {s["date"] for s in old_this_past}
    for s in new_list:
        if s["date"] < today_str and (s["date"] not in old_past_dates or s["date"] in fallback_dates) and s["date"] not in manual_dates:
            old_this_past.append(s)

    combined = sorted(
        other_members + this_manual + old_this_past + new_this,
        key=lambda x: (x["date"], x.get("member",""), x.get("time",""))
    )

    seen = set()
    deduped = []
    for s in combined:
        key = (s.get('member',''), s['date'], s.get('time','미정'), s.get('title','')[:30])
        if key not in seen:
            seen.add(key)
            deduped.append(s)

    if SUPABASE_URL and SUPABASE_ANON_KEY:
        print("  [Supabase] Saving updated schedules...")
        save_supabase_schedules(deduped)

    # Save to local file as fallback cache
    try:
        with open(SCHEDULE_PATH, "w", encoding="utf-8") as f:
            json.dump(deduped, f, ensure_ascii=False, indent=2)
    except Exception as e:
        print(f"  Failed to save local cache: {e}")

    return deduped

# ── Generate data.js ───────────────────────────────────────────────────────────
def generate_data_js(schedules):
    config_js = json.dumps(config, ensure_ascii=False)
    sched_js  = json.dumps(schedules, ensure_ascii=False)
    js = f"""// Auto-generated by sync_schedule.py — DO NOT EDIT MANUALLY
// Generated: {NOW.strftime('%Y-%m-%d %H:%M:%S')}
window.APP_CONFIG   = {config_js};
window.APP_SCHEDULE = {sched_js};
"""
    with open(DATA_JS_PATH, "w", encoding="utf-8") as f:
        f.write(js)
    print(f"  Generated {DATA_JS_PATH}  ({len(schedules)} total entries)")

# ── Main ───────────────────────────────────────────────────────────────────────
def main():
    # Fetch Google Sheet once (shared across all members)
    csv_data = fetch_google_sheet()

    all_schedules = []

    for member_key, member_info in MEMBERS.items():
        print(f"\n--- Processing: {member_info['name']} ({member_key}) ---")

        # 1. Parse this member's schedule from sheet(s) (Priority 1)
        personal_sheet_url = member_info.get("sheetUrl")
        if personal_sheet_url:
            print(f"  Fetching personal sheet: {personal_sheet_url}")
            personal_csv = fetch_personal_sheet(personal_sheet_url)
            personal_scheds = parse_monthly_grid_sheet(personal_csv, member_key)
            print(f"  Personal sheet entries: {len(personal_scheds)}")
            # Also parse the shared crew sheet for crew-wide events
            crew_scheds = parse_google_sheet(csv_data, member_key)
            print(f"  Crew sheet entries: {len(crew_scheds)}")
            sheet_scheds = personal_scheds + crew_scheds
        else:
            sheet_scheds = parse_google_sheet(csv_data, member_key)
        print(f"  Sheet entries (total): {len(sheet_scheds)}")

        # 2. Scrape Naver Cafe (Priority 2)
        cafe_scheds = []
        cafe_url = member_info.get("cafeUrl")
        if cafe_url:
            cafe_url = normalize_naver_cafe_url(cafe_url)
            if member_key == "homiming":
                try:
                    cafe_scheds = scrape_homiming_cafe_image_schedule(cafe_url, member_key)
                except Exception as scrap_err:
                    print(f"  Failed to scrape and parse Homiming Cafe image: {scrap_err}")
                print(f"  Naver Cafe Image entries: {len(cafe_scheds)}")
            else:
                print(f"  Fetching Naver Cafe: {cafe_url}")
                html = fetch_html_selenium(cafe_url)
                if html:
                    cafe_scheds = parse_cafe_html(html, member_key)
                    print(f"  Naver Cafe entries: {len(cafe_scheds)}")
                else:
                    print(f"  Failed to fetch Naver Cafe")

        # 3. Scrape each of their SOOP boards (Priority 3)
        soop_all = {}   # keyed by date to deduplicate across boards
        for board_url in member_info.get("soopBoards", []):
            print(f"  Fetching SOOP board: {board_url}")
            html = fetch_html_selenium(board_url)
            if html:
                notices = parse_soop_html(html, member_key)
                print(f"    -> {len(notices)} notices found")
                for n in notices:
                    date = n["date"]
                    # Since parse_soop_html parses in reverse chronological order (latest first),
                    # we keep only the first (most recent) notice we find for each date.
                    if date not in soop_all:
                        soop_all[date] = n
            else:
                print(f"    -> Failed to fetch")

        soop_notices = list(soop_all.values())
        print(f"  Total unique SOOP notices: {len(soop_notices)}")

        # 4. Merge all sources using the priority rules
        merged = merge_member_sources(sheet_scheds, cafe_scheds, soop_notices, member_key)
        print(f"  Merged entries: {len(merged)}")

        # 5. Cumulative save (preserves other members + past entries)
        all_schedules = cumulative_save(merged, member_key)

    # 6. Generate data.js with everything
    generate_data_js(all_schedules)
    print("\nDone OK")

if __name__ == "__main__":
    main()
