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
    def end_headers(self):
        if self.command == 'GET':
            self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
            self.send_header('Pragma', 'no-cache')
            self.send_header('Expires', '0')
        super().end_headers()

    def do_GET(self):
        try:
            if self.path == '/api/live_status':
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
                                    "url": f"https://ch.sooplive.com/{soop_id}"
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
                            "url": f"https://ch.sooplive.com/{soop_id}",
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
                
                # Save to schedule.json
                with open("schedule.json", "w", encoding="utf-8") as f:
                    json.dump(new_schedules, f, ensure_ascii=False, indent=2)
                
                # Regenerate data.js
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
                print("  [API] Saved schedule.json and data.js successfully")
            except Exception as e:
                self.send_response(500)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                self.wfile.write(json.dumps({"status": "error", "message": str(e)}).encode('utf-8'))
                print(f"  [API] Error saving schedule: {e}")
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
