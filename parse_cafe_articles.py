# -*- coding: utf-8 -*-
import os
import sys
import re
import json
import shutil
from datetime import datetime, timedelta
from PIL import Image

# Ensure stdout uses UTF-8 to prevent encoding crashes on Windows
sys.stdout.reconfigure(encoding='utf-8')

# Configure Tesseract path for Windows if it's not in PATH but installed in default directory
if os.name == 'nt':
    try:
        import pytesseract
        if not shutil.which("tesseract"):
            std_path = r"C:\Program Files\Tesseract-OCR\tesseract.exe"
            if os.path.exists(std_path):
                pytesseract.pytesseract.tesseract_cmd = std_path
    except ImportError:
        pass

def get_week_dates(base_date):
    day_names = ["월", "화", "수", "목", "금", "토", "일"]
    dates = []
    for i in range(7):
        d = base_date + timedelta(days=i)
        dates.append({
            "date": d.strftime("%Y-%m-%d"),
            "day": day_names[i]
        })
    return dates

def get_schedule_base_date(post_date_str, ocr_days_data=None):
    if ocr_days_data is None:
        ocr_days_data = {}
    post_date = datetime.strptime(post_date_str, "%Y-%m-%d")
    
    # Try to find date of Monday from MON card's OCR
    mon_day_num = ocr_days_data.get("MON", {}).get("day_num")
    if mon_day_num is not None:
        for m_offset in [0, -1, 1]:
            try:
                # Handle year/month boundaries
                cand = post_date + timedelta(days=30 * m_offset)
                cand = datetime(cand.year, cand.month, mon_day_num)
                if abs((cand - post_date).days) <= 7:
                    return cand
            except ValueError:
                pass
                
    # Fallback to Monday of post week (or next Monday if post is Sunday)
    weekday = post_date.weekday()
    if weekday == 6: # Sunday
        return post_date + timedelta(days=1)
    else:
        return post_date - timedelta(days=weekday)

def crop_day_cards(image_path):
    try:
        img = Image.open(image_path)
    except Exception as e:
        print(f"[OCR] Error opening image {image_path}: {e}")
        return None
        
    w, h = img.size
    
    # Coordinates in percentages (left, top, right, bottom)
    boxes = {
        "MON": (0.045, 0.10, 0.265, 0.50),
        "TUE": (0.265, 0.10, 0.485, 0.50),
        "WED": (0.485, 0.10, 0.705, 0.50),
        "THU": (0.705, 0.10, 0.925, 0.50),
        "FRI": (0.045, 0.50, 0.265, 0.90),
        "SAT": (0.265, 0.50, 0.485, 0.90),
        "SUN": (0.485, 0.50, 0.705, 0.90)
    }
    
    card_images = {}
    for day, box in boxes.items():
        left = int(box[0] * w)
        top = int(box[1] * h)
        right = int(box[2] * w)
        bottom = int(box[3] * h)
        card_images[day] = img.crop((left, top, right, bottom))
        
    return card_images

def run_ocr(card_images):
    import pytesseract
    ocr_results = {}
    for day, card_img in card_images.items():
        try:
            # OCR with both Korean and English
            text = pytesseract.image_to_string(card_img, lang='kor+eng')
            ocr_results[day] = text
        except Exception as e:
            print(f"[OCR] OCR failed for {day}: {e}")
            ocr_results[day] = ""
    return ocr_results

def parse_ocr_results(ocr_results):
    ocr_days_data = {}
    for day, text in ocr_results.items():
        lines = [line.strip() for line in text.split("\n") if line.strip()]
        
        # Find first date number
        day_num = None
        for line in lines:
            m = re.search(r"\b(\d{1,2})\b", line)
            if m:
                day_num = int(m.group(1))
                break
                
        # Clean lines: remove headers, day names, pure numbers
        cleaned_lines = []
        for line in lines:
            line_clean = re.sub(r'[\s\W_]+', '', line).upper()
            if not line_clean:
                continue
            if line_clean.isdigit() and len(line_clean) <= 2:
                continue
            if line_clean in ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN",
                              "MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY", "SUNDAY"]:
                continue
            if re.match(r"^\d+(MON|TUE|WED|THU|FRI|SAT|SUN|MONDAY|TUESDAY|WEDNESDAY|THURSDAY|FRIDAY|SATURDAY|SUNDAY)$", line_clean):
                continue
            cleaned_lines.append(line)
            
        ocr_days_data[day] = {
            "day_num": day_num,
            "lines": cleaned_lines
        }
    return ocr_days_data

def generate_fallback_schedules(member_key, article_url, image_url, post_date_str):
    print("[OCR] Generating fallback schedules ('일정 확인 중')...")
    base_monday = get_schedule_base_date(post_date_str)
    week_dates = get_week_dates(base_monday)
    
    schedules = []
    for wd in week_dates:
        schedules.append({
            "member": member_key,
            "date": wd["date"],
            "day": wd["day"],
            "time": "미정",
            "title": "일정 확인 중",
            "note": f"글: {article_url} | 이미지: {image_url}",
            "source": "naver_cafe_image",
            "url": article_url
        })
    return schedules

def parse_and_process():
    # Paths
    cafe_source_path = r"scratch/cafe_source.html"
    metadata_path = r"scratch/cafe_article_metadata.json"
    image_path = r"scratch/homiming_schedule.png"
    output_path = r"scratch/cafe_parsed_articles.json"
    
    # 1. Safety Check: If cafe_source.html does not exist, do not run!
    if not os.path.exists(cafe_source_path):
        print(f"[OCR] Error: Required file '{cafe_source_path}' does not exist. Exiting parser safely.")
        return False
        
    print(f"[OCR] Starting parsing stage since '{cafe_source_path}' exists.")
    
    # Load metadata
    if not os.path.exists(metadata_path):
        print(f"[OCR] Error: Metadata file '{metadata_path}' is missing.")
        return False
        
    with open(metadata_path, "r", encoding="utf-8") as f:
        metadata = json.load(f)
        
    member_key = metadata.get("member", "homiming")
    article_url = metadata.get("article_url", "")
    image_url = metadata.get("image_url", "")
    post_date_str = metadata.get("post_date", datetime.now().strftime("%Y-%m-%d"))
    
    schedules = []
    
    try:
        import pytesseract
        
        # Check if tesseract binary is runnable
        try:
            pytesseract.get_tesseract_version()
            tesseract_available = True
        except Exception as t_err:
            print(f"[OCR] Tesseract binary not found or not working: {t_err}")
            tesseract_available = False
            
        if not tesseract_available or not os.path.exists(image_path):
            raise Exception("Tesseract unavailable or schedule image missing.")
            
        print(f"[OCR] Cropping image '{image_path}'...")
        card_images = crop_day_cards(image_path)
        if not card_images:
            raise Exception("Failed to crop card images.")
            
        print(f"[OCR] Running OCR on cards (this might take a few seconds)...")
        ocr_results = run_ocr(card_images)
        
        ocr_days_data = parse_ocr_results(ocr_results)
        
        # Check if we got any dates or lines
        total_lines = sum(len(d["lines"]) for d in ocr_days_data.values())
        if total_lines < 3:
            raise Exception("OCR extracted insufficient text lines; layout parsing failed.")
            
        base_monday = get_schedule_base_date(post_date_str, ocr_days_data)
        week_dates = get_week_dates(base_monday)
        
        # Import time extractors from sync_schedule
        sys.path.insert(0, os.path.abspath(os.path.dirname(__file__)))
        from sync_schedule import extract_time, remove_time_patterns, is_generic_title
        
        days_map = {
            "MON": 0, "TUE": 1, "WED": 2, "THU": 3, "FRI": 4, "SAT": 5, "SUN": 6
        }
        
        for day_eng, idx in days_map.items():
            day_data = ocr_days_data[day_eng]
            date_str = week_dates[idx]["date"]
            day_kor = week_dates[idx]["day"]
            
            lines = day_data["lines"]
            
            # Find all lines containing distinct times
            lines_with_times = []
            for line in lines:
                t = extract_time(line)
                if t != "미정":
                    lines_with_times.append((line, t))
                    
            if len(lines_with_times) <= 1:
                # Process card as a single schedule entry
                time_str = lines_with_times[0][1] if lines_with_times else "미정"
                title = "일정 미정"
                note = "네이버 카페 이미지 일정 기준"
                
                if lines:
                    cleaned_lines = [remove_time_patterns(line).strip() for line in lines]
                    cleaned_lines = [line for line in cleaned_lines if line]
                    
                    is_rest = any("휴방" in line or "휴뱅" in line for line in lines)
                    if is_rest:
                        title = "휴방"
                        rest_lines = [line for line in cleaned_lines if "휴방" not in line and "휴뱅" not in line]
                        note = " / ".join(rest_lines) if rest_lines else "휴방"
                    else:
                        if cleaned_lines:
                            title = cleaned_lines[0]
                            note = " / ".join(cleaned_lines[1:]) if len(cleaned_lines) > 1 else "네이버 카페 이미지 일정 기준"
                        else:
                            title = "미정"
                            note = "네이버 카페 이미지 일정 기준"
                            
                if is_generic_title(title):
                    title = "미정"
                    
                schedules.append({
                    "member": member_key,
                    "date": date_str,
                    "day": day_kor,
                    "time": time_str,
                    "title": title,
                    "note": note,
                    "source": "naver_cafe_image",
                    "url": article_url
                })
            else:
                # Split card into multiple schedules based on the lines with times
                events = []
                current_event = None
                
                for line in lines:
                    t = extract_time(line)
                    if t != "미정":
                        if current_event:
                            events.append(current_event)
                        current_event = {
                            "time": t,
                            "lines": [line]
                        }
                    else:
                        if current_event:
                            current_event["lines"].append(line)
                        else:
                            current_event = {
                                "time": "미정",
                                "lines": [line]
                            }
                if current_event:
                    events.append(current_event)
                    
                # Process each event
                for event in events:
                    e_time = event["time"]
                    e_lines = event["lines"]
                    
                    e_cleaned = [remove_time_patterns(line).strip() for line in e_lines]
                    e_cleaned = [line for line in e_cleaned if line]
                    
                    is_rest = any("휴방" in line or "휴뱅" in line for line in e_lines)
                    if is_rest:
                        e_title = "휴방"
                        rest_lines = [line for line in e_cleaned if "휴방" not in line and "휴뱅" not in line]
                        e_note = " / ".join(rest_lines) if rest_lines else "휴방"
                    else:
                        if e_cleaned:
                            e_title = e_cleaned[0]
                            e_note = " / ".join(e_cleaned[1:]) if len(e_cleaned) > 1 else "네이버 카페 이미지 일정 기준"
                        else:
                            e_title = "미정"
                            e_note = "네이버 카페 이미지 일정 기준"
                            
                    if is_generic_title(e_title):
                        e_title = "미정"
                        
                    schedules.append({
                        "member": member_key,
                        "date": date_str,
                        "day": day_kor,
                        "time": e_time,
                        "title": e_title,
                        "note": e_note,
                        "source": "naver_cafe_image",
                        "url": article_url
                    })
            
        print(f"[OCR] Successfully parsed {len(schedules)} schedule entries via OCR.")
        
    except Exception as e:
        print(f"[OCR] Parsing failed: {e}")
        schedules = generate_fallback_schedules(member_key, article_url, image_url, post_date_str)
        
    # Write parsed schedules to json
    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(schedules, f, ensure_ascii=False, indent=2)
        
    print(f"[OCR] Saved parsed schedules to: {output_path}")
    return schedules

if __name__ == "__main__":
    parse_and_process()
