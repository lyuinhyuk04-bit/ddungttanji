import http.server
import socketserver
import json
import os
from datetime import datetime
import urllib.request
import ssl
from concurrent.futures import ThreadPoolExecutor

PORT = 8000

class ScheduleHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, format, *args):
        # Override to avoid stderr write error in Windows background task
        pass

    def end_headers(self):
        if self.command == 'GET':
            self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
            self.send_header('Pragma', 'no-cache')
            self.send_header('Expires', '0')
        super().end_headers()

    def do_GET(self):
        try:
            if self.path in ('/events', '/events/'):
                self.path = '/index.html'

            if self.path.startswith('/api/live_status'):
                import urllib.parse
                parsed_url = urllib.parse.urlparse(self.path)
                query_params = urllib.parse.parse_qs(parsed_url.query)
                
                custom_ids = query_params.get("ids", [])
                members = {}
                if custom_ids:
                    id_list = [i.strip() for val in custom_ids for i in val.split(",") if i.strip()]
                    for i in id_list:
                        members[i] = {"soopId": i, "name": i}
                else:
                    config_path = "config.json"
                    if not os.path.exists(config_path):
                        self.send_response(404)
                        self.end_headers()
                        self.wfile.write(b"config.json not found")
                        return
                    
                    with open(config_path, "r", encoding="utf-8") as f:
                        config = json.load(f)
                    
                    members = config.get("members", {})
                
                ctx = ssl.create_default_context()
                ctx.check_hostname = False
                ctx.verify_mode = ssl.CERT_NONE
                
                def fetch_member_status(key, m):
                    soop_id = m.get("soopId")
                    if not soop_id:
                        return {
                            "member": key,
                            "name": m.get("name", ""),
                            "is_live": False,
                            "profile_image": "",
                            "broad_title": "SOOP ID 없음",
                            "url": "#"
                        }
                    
                    url = f"https://bjapi.afreecatv.com/api/{soop_id}/station"
                    headers = {
                        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
                    }
                    try:
                        req = urllib.request.Request(url, headers=headers)
                        with urllib.request.urlopen(req, context=ctx, timeout=3) as r:
                            data = r.read().decode("utf-8")
                            obj = json.loads(data)
                            
                            profile_img = obj.get("profile_image", "")
                            if profile_img.startswith("//"):
                                profile_img = "https:" + profile_img
                                
                            broad = obj.get("broad")
                            is_live = broad is not None
                            
                            res = {
                                "member": key,
                                "name": m.get("name", ""),
                                "soopId": soop_id,
                                "is_live": is_live,
                                "profile_image": profile_img,
                            }
                            
                            if is_live:
                                broad_no = broad.get("broad_no")
                                res.update({
                                    "broad_title": broad.get("broad_title", ""),
                                    "broad_no": broad_no,
                                    "thumbnail": f"https://liveimg.sooplive.com/h/{broad_no}.gif",
                                    "url": f"https://play.sooplive.com/{soop_id}/{broad_no}"
                                })
                            else:
                                res.update({
                                    "broad_title": "방송 준비 중",
                                    "broad_no": "",
                                    "thumbnail": profile_img,
                                    "url": f"https://www.sooplive.com/station/{soop_id}"
                                })
                            return res
                    except Exception as e:
                        return {
                            "member": key,
                            "name": m.get("name", ""),
                            "soopId": soop_id,
                            "is_live": False,
                            "profile_image": "",
                            "broad_title": "오프라인 (오류)",
                            "broad_no": "",
                            "thumbnail": "",
                            "url": f"https://www.sooplive.com/station/{soop_id}",
                            "error": str(e)
                        }

                with ThreadPoolExecutor(max_workers=9) as executor:
                    futures = [executor.submit(fetch_member_status, key, m) for key, m in members.items()]
                    results = [f.result() for f in futures]
                
                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                self.wfile.write(json.dumps(results, ensure_ascii=False).encode('utf-8'))
            elif self.path == '/api/schedules':
                config_path = "config.json"
                config = {}
                if os.path.exists(config_path):
                    with open(config_path, "r", encoding="utf-8") as f:
                        config = json.load(f)
                
                schedules = None
                supabase_url = os.environ.get("SUPABASE_URL")
                supabase_anon_key = os.environ.get("SUPABASE_ANON_KEY")
                if supabase_url and supabase_anon_key:
                    url = f"{supabase_url}/rest/v1/schedules?select=*"
                    req = urllib.request.Request(
                        url,
                        headers={
                            "apikey": supabase_anon_key,
                            "Authorization": f"Bearer {supabase_anon_key}"
                        }
                    )
                    try:
                        ctx = ssl.create_default_context()
                        ctx.check_hostname = False
                        ctx.verify_mode = ssl.CERT_NONE
                        with urllib.request.urlopen(req, context=ctx, timeout=5) as r:
                            schedules = json.loads(r.read().decode("utf-8"))
                            schedules.sort(key=lambda x: (x.get("date",""), x.get("member",""), x.get("time","")))
                    except Exception as e:
                        print(f"  [Server] Supabase fetch failed: {e}")
                
                if schedules is None:
                    schedules = []
                    schedule_path = "schedule.json"
                    if os.path.exists(schedule_path):
                        with open(schedule_path, "r", encoding="utf-8") as f:
                            schedules = json.load(f)
                
                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                res_payload = {"config": config, "schedules": schedules}
                self.wfile.write(json.dumps(res_payload, ensure_ascii=False).encode('utf-8'))
            elif self.path == '/api/events':
                events = None
                supabase_url = os.environ.get("SUPABASE_URL")
                supabase_anon_key = os.environ.get("SUPABASE_ANON_KEY")
                if supabase_url and supabase_anon_key:
                    url = f"{supabase_url}/rest/v1/events?select=*"
                    req = urllib.request.Request(
                        url,
                        headers={
                            "apikey": supabase_anon_key,
                            "Authorization": f"Bearer {supabase_anon_key}"
                        }
                    )
                    try:
                        ctx = ssl.create_default_context()
                        ctx.check_hostname = False
                        ctx.verify_mode = ssl.CERT_NONE
                        with urllib.request.urlopen(req, context=ctx, timeout=5) as r:
                            events = json.loads(r.read().decode("utf-8"))
                    except Exception as e:
                        print(f"  [Server] Supabase fetch events failed: {e}")
                
                if events is None:
                    events = []
                    events_path = "events.json"
                    if os.path.exists(events_path):
                        with open(events_path, "r", encoding="utf-8") as f:
                            events = json.load(f)
                
                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                self.wfile.write(json.dumps(events, ensure_ascii=False).encode('utf-8'))
            elif self.path.startswith('/api/fetch_og'):
                import urllib.parse
                parsed_url = urllib.parse.urlparse(self.path)
                query_params = urllib.parse.parse_qs(parsed_url.query)
                target_url = query_params.get("url", [None])[0]
                if not target_url:
                    self.send_response(400)
                    self.send_header('Access-Control-Allow-Origin', '*')
                    self.end_headers()
                    self.wfile.write(b"Missing url parameter")
                    return
                
                user_agent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
                req = urllib.request.Request(
                    target_url,
                    headers={"User-Agent": user_agent}
                )
                
                title = ""
                description = ""
                image_base64 = ""
                
                try:
                    ctx = ssl.create_default_context()
                    ctx.check_hostname = False
                    ctx.verify_mode = ssl.CERT_NONE
                    with urllib.request.urlopen(req, context=ctx, timeout=5) as r:
                        html = r.read().decode('utf-8', errors='ignore')
                        
                        import re
                        title_match = re.search(r'<meta\s+property=["\']og:title["\']\s+content=["\'](.*?)["\']', html, re.IGNORECASE) or \
                                      re.search(r'<meta\s+content=["\'](.*?)["\']\s+property=["\']og:title["\']', html, re.IGNORECASE)
                        if title_match:
                            title = title_match.group(1)
                        else:
                            t_match = re.search(r'<title>(.*?)</title>', html, re.IGNORECASE)
                            if t_match:
                                title = t_match.group(1)
                        
                        desc_match = re.search(r'<meta\s+property=["\']og:description["\']\s+content=["\'](.*?)["\']', html, re.IGNORECASE) or \
                                     re.search(r'<meta\s+content=["\'](.*?)["\']\s+property=["\']og:description["\']', html, re.IGNORECASE) or \
                                     re.search(r'<meta\s+name=["\']description["\']\s+content=["\'](.*?)["\']', html, re.IGNORECASE) or \
                                     re.search(r'<meta\s+content=["\'](.*?)["\']\s+name=["\']description["\']', html, re.IGNORECASE)
                        if desc_match:
                            description = desc_match.group(1)
                            
                        img_match = re.search(r'<meta\s+property=["\']og:image["\']\s+content=["\'](.*?)["\']', html, re.IGNORECASE) or \
                                    re.search(r'<meta\s+content=["\'](.*?)["\']\s+property=["\']og:image["\']', html, re.IGNORECASE)
                        if img_match:
                            og_image = img_match.group(1)
                            if og_image.startswith('//'):
                                og_image = 'https:' + og_image
                            elif og_image.startsWith('/'):
                                parsed_t = urllib.parse.urlparse(target_url)
                                og_image = f"{parsed_t.scheme}://{parsed_t.netloc}{og_image}"
                                
                            try:
                                img_req = urllib.request.Request(og_image, headers={"User-Agent": user_agent})
                                with urllib.request.urlopen(img_req, context=ctx, timeout=5) as img_res:
                                    img_data = img_res.read()
                                    content_type = img_res.headers.get("Content-Type", "image/jpeg")
                                    import base64
                                    img_b64 = base64.b64encode(img_data).decode("utf-8")
                                    image_base64 = f"data:{content_type};base64,{img_b64}"
                            except Exception as img_err:
                                print(f"  [Server] Failed to fetch image {og_image}: {img_err}")
                except Exception as e:
                    print(f"  [Server] Failed to fetch OG for {target_url}: {e}")
                
                def decode_entities(s):
                    import html as html_parser
                    return html_parser.unescape(s)
                
                title = decode_entities(title)
                description = decode_entities(description)
                
                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                res_payload = {
                    "title": title,
                    "description": description,
                    "image": image_base64,
                    "link": target_url
                }
                self.wfile.write(json.dumps(res_payload, ensure_ascii=False).encode('utf-8'))
            else:
                super().do_GET()
        except Exception as e:
            import traceback
            with open("server_error.log", "w", encoding="utf-8") as f:
                traceback.print_exc(file=f)
            self.send_response(500)
            self.end_headers()

    def do_POST(self):
        if self.path == '/api/save_schedule':
            content_length = int(self.headers['Content-Length'])
            post_data = self.rfile.read(content_length)
            try:
                new_schedules = json.loads(post_data.decode('utf-8'))
                
                supabase_url = os.environ.get("SUPABASE_URL")
                supabase_anon_key = os.environ.get("SUPABASE_ANON_KEY")
                
                if supabase_url and supabase_anon_key:
                    ctx = ssl.create_default_context()
                    ctx.check_hostname = False
                    ctx.verify_mode = ssl.CERT_NONE
                    
                    # 1. Clear existing schedules
                    delete_url = f"{supabase_url}/rest/v1/schedules?id=not.is.null"
                    delete_req = urllib.request.Request(
                        delete_url,
                        headers={
                            "apikey": supabase_anon_key,
                            "Authorization": f"Bearer {supabase_anon_key}"
                        },
                        method="DELETE"
                    )
                    with urllib.request.urlopen(delete_req, context=ctx, timeout=10) as r:
                        pass
                        
                    # 2. Insert new records in bulk
                    payload = []
                    for s in new_schedules:
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
                        
                    insert_url = f"{supabase_url}/rest/v1/schedules"
                    insert_req = urllib.request.Request(
                        insert_url,
                        data=json.dumps(payload).encode("utf-8"),
                        headers={
                            "apikey": supabase_anon_key,
                            "Authorization": f"Bearer {supabase_anon_key}",
                            "Content-Type": "application/json"
                        },
                        method="POST"
                    )
                    with urllib.request.urlopen(insert_req, context=ctx, timeout=10) as r:
                        pass
                    print("  [Server] Saved to Supabase successfully")
                else:
                    with open("schedule.json", "w", encoding="utf-8") as f:
                        json.dump(new_schedules, f, ensure_ascii=False, indent=2)
                    print("  [Server] Saved to schedule.json successfully")
                
                # Regenerate local data.js cache
                config = {}
                if os.path.exists("config.json"):
                    with open("config.json", "r", encoding="utf-8") as f:
                        config = json.load(f)
                
                config_js = json.dumps(config, ensure_ascii=False)
                sched_js  = json.dumps(new_schedules, ensure_ascii=False)
                now_str = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
                js_content = f"""// Auto-generated by server.py — DO NOT EDIT MANUALLY
// Generated: {now_str}
window.APP_CONFIG   = {config_js};
window.APP_SCHEDULE = {sched_js};
"""
                with open("data.js", "w", encoding="utf-8") as f:
                    f.write(js_content)
                
                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                self.wfile.write(json.dumps({"status": "ok", "message": "Saved successfully"}).encode('utf-8'))
            except Exception as e:
                self.send_response(500)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                self.wfile.write(json.dumps({"status": "error", "message": str(e)}).encode('utf-8'))
                print(f"  [Server] Error saving schedule: {e}")
        elif self.path == '/api/save_events':
            content_length = int(self.headers['Content-Length'])
            post_data = self.rfile.read(content_length)
            try:
                new_events = json.loads(post_data.decode('utf-8'))
                
                supabase_url = os.environ.get("SUPABASE_URL")
                supabase_anon_key = os.environ.get("SUPABASE_ANON_KEY")
                
                if supabase_url and supabase_anon_key:
                    ctx = ssl.create_default_context()
                    ctx.check_hostname = False
                    ctx.verify_mode = ssl.CERT_NONE
                    
                    # 1. Clear existing events
                    delete_url = f"{supabase_url}/rest/v1/events?id=not.is.null"
                    delete_req = urllib.request.Request(
                        delete_url,
                        headers={
                            "apikey": supabase_anon_key,
                            "Authorization": f"Bearer {supabase_anon_key}"
                        },
                        method="DELETE"
                    )
                    with urllib.request.urlopen(delete_req, context=ctx, timeout=10) as r:
                        pass
                        
                    # 2. Insert new records in bulk
                    payload = []
                    for e in new_events:
                        payload.append({
                            "title": e.get("title", ""),
                            "start_date": e.get("start_date", ""),
                            "end_date": e.get("end_date", ""),
                            "description": e.get("description", ""),
                            "link": e.get("link", ""),
                            "image": e.get("image", "")
                        })
                    
                    if payload:
                        insert_url = f"{supabase_url}/rest/v1/events"
                        insert_req = urllib.request.Request(
                            insert_url,
                            data=json.dumps(payload).encode("utf-8"),
                            headers={
                                "apikey": supabase_anon_key,
                                "Authorization": f"Bearer {supabase_anon_key}",
                                "Content-Type": "application/json"
                            },
                            method="POST"
                        )
                        with urllib.request.urlopen(insert_req, context=ctx, timeout=10) as r:
                            pass
                    print("  [Server] Saved events to Supabase successfully")
                else:
                    with open("events.json", "w", encoding="utf-8") as f:
                        json.dump(new_events, f, ensure_ascii=False, indent=2)
                    print("  [Server] Saved events to events.json successfully")
                
                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                self.wfile.write(json.dumps({"status": "ok", "message": "Saved successfully"}).encode('utf-8'))
            except Exception as e:
                self.send_response(500)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                self.wfile.write(json.dumps({"status": "error", "message": str(e)}).encode('utf-8'))
                print(f"  [Server] Error saving events: {e}")
        else:
            self.send_response(404)
            self.end_headers()

    def do_OPTIONS(self):
        # Handle CORS preflight
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()

def run():
    socketserver.TCPServer.allow_reuse_address = True
    with socketserver.TCPServer(("", PORT), ScheduleHandler) as httpd:
        print(f"Local Server running at http://localhost:{PORT}")
        print("Press Ctrl+C to stop the server.")
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nShutting down server...")

if __name__ == '__main__':
    run()
