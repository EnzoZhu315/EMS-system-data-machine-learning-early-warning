import requests
import json
import urllib3
import gspread
import time
import os
from datetime import datetime, timedelta
from oauth2client.service_account import ServiceAccountCredentials

# 禁用 SSL 警告（建议在生产环境中使用合法证书并移除此行）
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

# ================= 1. 配置区域 (已脱敏) =================
# 建议：将敏感信息存储在环境变量或外部 .env 文件中
CONFIG = {
    "JSON_KEY_FILE": "path/to/your/service_account_credentials.json",
    "SHEET_URL": "https://docs.google.com/spreadsheets/d/YOUR_SPREADSHEET_ID_HERE/edit",
    "EMS_BASE_URL": "https://your-ems-portal-domain.com",
    "EMS_USER": os.getenv("EMS_USER", "YOUR_USERNAME"),
    "EMS_PWD": os.getenv("EMS_PWD", "YOUR_PASSWORD"),
}

# ID 映射表：已将具体的 node_id 和机台号改为通用示例
# 实际上传 GitHub 时，可以只保留 1-2 个示例
MACHINE_MAP = {
    "UNIT_01": {"e": "ems_node_electric_001", "p": "ems_node_production_001"},
    "UNIT_02": {"e": "ems_node_electric_002", "p": "ems_node_production_002"},
    # ... 更多机台以此类推
}

def get_cycle_dates():
    """获取财务月周期及历史区间时间戳"""
    now = datetime.now()
    # 财务月逻辑：每月15号切换
    c_15 = now.replace(day=15, hour=0, minute=0, second=0, microsecond=0)
    if now < c_15:
        this_start = (c_15 - timedelta(days=32)).replace(day=15)
    else:
        this_start = c_15

    # 历史起点锁定
    hist_start = datetime(2020, 1, 1) # 示例起始时间
    hist_end = this_start

    to_ts = lambda d: int(d.timestamp() * 1000)
    return to_ts(hist_start), to_ts(hist_end), to_ts(this_start), to_ts(now), this_start.strftime("%Y-%m")


class EMSClient:
    def __init__(self):
        self.base_url = CONFIG["EMS_BASE_URL"]
        self.token = None
        self.cookies_str = None

    def login(self):
        """登录 EMS 系统获取 Token 和 Cookies"""
        try:
            # 脱敏：使用通用的 Auth 路径
            auth_url = f'{self.base_url}/auth/realms/your_realm/protocol/openid-connect/token'
            t_res = requests.post(auth_url, data={
                'username': CONFIG["EMS_USER"], 
                'password': CONFIG["EMS_PWD"],
                'client_id': 'your_client_id', 
                'grant_type': 'password'
            }, verify=False, timeout=20)
            
            self.token = t_res.json().get('access_token')
            
            # 登录维持逻辑
            login_endpoint = f'{self.base_url}/api/rest/login'
            ck_res = requests.post(login_endpoint,
                                   json={'token': self.token},
                                   headers={'Authorization': f'Bearer {self.token}'}, verify=False)
            self.cookies_str = '; '.join([f'{k}={v}' for k, v in ck_res.cookies.items()])
            return True
        except Exception as e:
            print(f"Login Error: {e}")
            return False

    def fetch_val(self, item_id, start_ts, end_ts):
        """通用数据提取逻辑"""
        url = f'{self.base_url}/api/rest/history/values/search'
        payload = {
            "data": {
                "items": item_id, 
                "from": start_ts, 
                "to": end_ts,
                "aggregates": 15, 
                "span": 5, 
                "withOffset": True
            }
        }
        headers = {
            'Authorization': f'Bearer {self.token}',
            'Content-Type': 'application/json-patch+json',
            'Cookie': f'token=Bearer {self.token}; {self.cookies_str}'
        }

        try:
            res = requests.post(url, json=payload, headers=headers, verify=False, timeout=30)
            if res.status_code != 200: return 0.0
            resp_json = res.json()
            
            total = 0.0
            # 解析逻辑保持不变，但路径泛化
            points = resp_json.get('data', {}).get('data', [])
            if not points: points = resp_json.get('data', [])

            for p in points:
                val = p.get('val') if isinstance(p, dict) else (p[1] if isinstance(p, list) and len(p) > 1 else None)
                if val is not None and str(val).lower() != 'none':
                    total += float(val)
            return total
        except:
            return 0.0


def main():
    h_start, h_end, c_start, c_end, month_label = get_cycle_dates()
    client = EMSClient()
    if not client.login():
        print("✗ EMS Login Failed")
        return

    try:
        # Google Sheets 认证
        creds = ServiceAccountCredentials.from_json_keyfile_name(
            CONFIG["JSON_KEY_FILE"],
            ['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/drive']
        )
        gs = gspread.authorize(creds)
        sheet = gs.open_by_url(CONFIG["SHEET_URL"])
        
        target_ws_name = "Energy_score"
        try:
            ws = sheet.worksheet(target_ws_name)
        except gspread.exceptions.WorksheetNotFound:
            print(f"Creating worksheet: {target_ws_name}")
            ws = sheet.add_worksheet(title=target_ws_name, rows="1000", cols="20")
    except Exception as e:
        print(f"✗ Connection Error: {e}")
        return

    final_rows = []
    print(f"🚀 Task Started | Target Month: {month_label}")

    for entity_id, ids in MACHINE_MAP.items():
        print(f"Processing {entity_id}...", end=" ", flush=True)

        # 1. 获取历史基准
        h_e = client.fetch_val(ids['e'], h_start, h_end)
        h_p = client.fetch_val(ids['p'], h_start, h_end)
        baseline = h_e / h_p if h_p > 0 else 0

        # 2. 获取本月当前数据
        c_e = client.fetch_val(ids['e'], c_start, c_end)
        c_p = client.fetch_val(ids['p'], c_start, c_end)
        c_avg = c_e / c_p if c_p > 0 else 0

        # 3. 计算偏移
        drift = (c_avg - baseline) / baseline if baseline > 0 and c_p > 0 else 0.0

        print("Done")

        # 构建写入行
        final_rows.append([
            month_label, entity_id, 
            round(c_e, 1), round(c_p, 1), round(c_avg, 3), 
            round(h_e, 1), round(h_p, 1), round(baseline, 3), 
            f"{drift:.2%}"
        ])
        time.sleep(0.2) # 避免 API 速率限制

    # 写入表格逻辑
    if len(ws.get_all_values()) == 0:
        headers = ["Month", "Entity", "Curr_Elec", "Curr_Prod", "Curr_Consum", "Hist_Elec", "Hist_Prod", "Hist_Base", "Drift"]
        ws.append_row(headers)

    ws.append_rows(final_rows)
    print("\n🎉 All data synced to Google Sheets.")


if __name__ == "__main__":
    main()
