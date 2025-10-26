import requests
import json
import sys
import base64
import os
from datetime import datetime

def get_config():
    """从环境变量获取配置"""
    config = {
        "api_key": os.environ.get('WEATHER_API_KEY', ''),
        "api_host": os.environ.get('WEATHER_API_HOST', ''),
        "cities": json.loads(os.environ.get('WEATHER_CITIES', '{}')),
        "telegram": {
            "bot_token": os.environ.get('TELEGRAM_BOT_TOKEN', ''),
            "chat_id": os.environ.get('TELEGRAM_CHAT_ID', '')
        },
        "wechat_work": {
            "webhook_url": os.environ.get('WECHAT_WORK_WEBHOOK', '')
        },
        "github": {
            "token": os.environ.get('NOTIFY_GITHUB_TOKEN', ''),
            "repo_owner": os.environ.get('NOTIFY_REPO_OWNER', ''),
            "repo_name": os.environ.get('NOTIFY_REPO_NAME', ''),
            "file_path": os.environ.get('NOTIFY_FILE_PATH', 'data.json')
        }
    }
    return config

def send_telegram_message(message, config):
    """发送消息到Telegram"""
    if not config['telegram']['bot_token'] or not config['telegram']['chat_id']:
        print("❌ Telegram配置不完整，跳过发送")
        return False
        
    try:
        url = f"https://api.telegram.org/bot{config['telegram']['bot_token']}/sendMessage"
        payload = {
            "chat_id": config['telegram']['chat_id'],
            "text": message,
            "parse_mode": "HTML"
        }
        response = requests.post(url, json=payload, timeout=10)
        if response.status_code == 200:
            print("✅ Telegram通知发送成功")
            return True
        else:
            print(f"❌ Telegram通知发送失败: {response.text}")
            return False
    except Exception as e:
        print(f"❌ Telegram通知异常: {e}")
        return False

def send_wechat_message(message, config):
    """发送消息到企业微信"""
    if not config['wechat_work']['webhook_url']:
        print("❌ 企业微信配置不完整，跳过发送")
        return False
        
    try:
        # 移除HTML标签，使用纯文本格式
        plain_text = message.replace('<b>', '').replace('</b>', '')
        payload = {
            "msgtype": "text",
            "text": {
                "content": plain_text
            }
        }
        response = requests.post(config['wechat_work']['webhook_url'], 
                               json=payload, timeout=10)
        if response.status_code == 200:
            print("✅ 企业微信通知发送成功")
            return True
        else:
            print(f"❌ 企业微信通知发送失败: {response.text}")
            return False
    except Exception as e:
        print(f"❌ 企业微信通知异常: {e}")
        return False

def get_weather_all(location_id, config):
    """一次性获取所有天气信息"""
    base_url = f"https://{config['api_host']}"
    headers = {"X-QW-Api-Key": config['api_key']}
    
    results = {}
    
    # 实时天气
    try:
        response = requests.get(
            f"{base_url}/v7/weather/now",
            params={"location": location_id, "key": config['api_key'], "lang": "zh", "unit": "m"},
            headers=headers,
            timeout=10
        )
        if response.status_code == 200:
            results['now'] = response.json()
    except Exception as e:
        print(f"❌ 获取实时天气失败: {e}")
    
    # 空气质量
    try:
        response = requests.get(
            f"{base_url}/v7/air/now",
            params={"location": location_id, "key": config['api_key'], "lang": "zh"},
            headers=headers,
            timeout=10
        )
        if response.status_code == 200:
            results['air'] = response.json()
    except Exception as e:
        print(f"❌ 获取空气质量失败: {e}")
    
    # 3天预报
    try:
        response = requests.get(
            f"{base_url}/v7/weather/3d",
            params={"location": location_id, "key": config['api_key'], "lang": "zh", "unit": "m"},
            headers=headers,
            timeout=10
        )
        if response.status_code == 200:
            results['forecast'] = response.json()
    except Exception as e:
        print(f"❌ 获取天气预报失败: {e}")
    
    return results

def format_weather_message(data, city_name, format_type="html"):
    """格式化天气消息"""
    if not data.get('now') or data['now'].get('code') != '200':
        return f"❌ {city_name}: 获取天气失败"
    
    now = data['now']['now']
    
    if format_type == "html":
        # Telegram 使用 HTML 格式
        message = [
            f"🏙️ <b>{city_name}</b>",
            f"🌡️ 温度: {now['temp']}°C | {now['text']}",
            f"💨 风向: {now['windDir']}{now['windScale']}级 | 💧湿度: {now['humidity']}%"
        ]
        
        if data.get('air') and data['air'].get('code') == '200':
            air = data['air']['now']
            message.append(f"🌬️ 空气质量: {air['category']} | AQI: {air['aqi']}")
        
        # 添加3天预报
        if data.get('forecast') and data['forecast'].get('code') == '200':
            forecast = data['forecast']['daily']
            message.append("\n📅 <b>未来3天预报:</b>")
            for i, day in enumerate(forecast[:3]):
                date = day['fxDate']
                day_msg = f"  {date}: {day['textDay']} {day['tempMin']}°C~{day['tempMax']}°C"
                message.append(day_msg)
    else:
        # 纯文本格式（用于企业微信和控制台）
        message = [
            f"🏙️ {city_name}",
            f"🌡️ 温度: {now['temp']}°C | {now['text']}",
            f"💨 风向: {now['windDir']}{now['windScale']}级 | 💧湿度: {now['humidity']}%"
        ]
        
        if data.get('air') and data['air'].get('code') == '200':
            air = data['air']['now']
            message.append(f"🌬️ 空气质量: {air['category']} | AQI: {air['aqi']}")
        
        # 添加3天预报
        if data.get('forecast') and data['forecast'].get('code') == '200':
            forecast = data['forecast']['daily']
            message.append("\n📅 未来3天预报:")
            for i, day in enumerate(forecast[:3]):
                date = day['fxDate']
                day_msg = f"  {date}: {day['textDay']} {day['tempMin']}°C~{day['tempMax']}°C"
                message.append(day_msg)
    
    return "\n".join(message)

def update_github_notification(weather_message, config):
    """更新GitHub仓库中的data.json通知"""
    if not config['github']['token']:
        print("❌ GitHub配置不完整，跳过更新")
        return False
        
    try:
        # GitHub API 配置
        token = config['github']['token']
        owner = config['github']['repo_owner']
        repo = config['github']['repo_name']
        path = config['github']['file_path']
        
        headers = {
            'Authorization': f'token {token}',
            'Accept': 'application/vnd.github.v3+json'
        }
        
        # 1. 获取当前文件内容和SHA
        url = f"https://api.github.com/repos/{owner}/{repo}/contents/{path}"
        response = requests.get(url, headers=headers)
        
        if response.status_code != 200:
            print(f"❌ 获取GitHub文件失败: {response.status_code}")
            return False
        
        file_data = response.json()
        current_content = base64.b64decode(file_data['content']).decode('utf-8')
        file_sha = file_data['sha']
        
        # 2. 解析JSON并更新通知
        data = json.loads(current_content)
        
        # 查找id为1的通知
        notification_updated = False
        for notification in data['notifications']:
            if notification['id'] == 1:
                # 更新现有通知
                notification['title'] = "实时天气通知"
                notification['content'] = weather_message.replace('\n', '<br>')
                notification['date'] = datetime.now().strftime("%Y-%m-%dT%H:%M:%S")
                notification_updated = True
                break
        
        if not notification_updated:
            # 如果没有找到id为1的通知，创建一个新的
            new_notification = {
                "id": 1,
                "title": "实时天气通知",
                "content": weather_message.replace('\n', '<br>'),
                "date": datetime.now().strftime("%Y-%m-%dT%H:%M:%S")
            }
            data['notifications'].append(new_notification)
        
        # 3. 更新文件
        updated_content = json.dumps(data, ensure_ascii=False, indent=2)
        encoded_content = base64.b64encode(updated_content.encode('utf-8')).decode('utf-8')
        
        commit_data = {
            "message": f"更新天气通知 - {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}",
            "content": encoded_content,
            "sha": file_sha
        }
        
        update_response = requests.put(url, headers=headers, json=commit_data)
        
        if update_response.status_code == 200:
            print("✅ GitHub通知更新成功")
            return True
        else:
            print(f"❌ GitHub通知更新失败: {update_response.status_code} - {update_response.text}")
            return False
            
    except Exception as e:
        print(f"❌ GitHub通知更新异常: {e}")
        return False

def ql_weather():
    """青龙面板专用函数"""
    config = get_config()
    
    # 检查必要配置
    if not config['api_key'] or not config['api_host'] or not config['cities']:
        print("❌ 缺少必要的天气API配置")
        return []
    
    all_messages_html = []  # Telegram 使用 HTML 格式
    all_messages_plain = []  # 企业微信和控制台使用纯文本格式
    
    for city_name, location_id in config['cities'].items():
        print(f"正在获取 {city_name} 的天气信息...")
        data = get_weather_all(location_id, config)
        html_message = format_weather_message(data, city_name, "html")
        plain_message = format_weather_message(data, city_name, "plain")
        all_messages_html.append(html_message)
        all_messages_plain.append(plain_message)
    
    # 输出给青龙面板（使用纯文本格式）
    for msg in all_messages_plain:
        print(msg)
    
    # 发送通知
    if all_messages_html and all_messages_plain:
        full_message_html = "\n\n".join(all_messages_html)
        full_message_plain = "\n\n".join(all_messages_plain)
        
        # 发送到Telegram（使用HTML格式）
        send_telegram_message(full_message_html, config)
        
        # 发送到企业微信（使用纯文本格式）
        send_wechat_message(full_message_plain, config)
        
        # 更新GitHub通知（使用纯文本格式，但转换为HTML换行）
        update_github_notification(full_message_plain, config)
    
    return all_messages_plain

def main():
    """主函数"""
    config = get_config()
    
    # 检查必要配置
    if not config['api_key'] or not config['api_host'] or not config['cities']:
        print("❌ 缺少必要的天气API配置")
        print("请设置以下环境变量:")
        print("  WEATHER_API_KEY: 天气API密钥")
        print("  WEATHER_API_HOST: 天气API主机")
        print("  WEATHER_CITIES: 城市JSON，如: '{\"城市1\":\"ID1\",\"城市2\":\"ID2\"}'")
        return
    
    for city_name, location_id in config['cities'].items():
        print(f"\n查询 {city_name}:")
        data = get_weather_all(location_id, config)
        if data.get('now'):
            now = data['now']['now']
            print(f"  温度: {now['temp']}°C")
            print(f"  天气: {now['text']}")
            print(f"  风向: {now['windDir']} {now['windScale']}级")
        else:
            print(f"  ❌ 获取天气信息失败")

if __name__ == "__main__":
    # 如果在青龙面板中运行或作为GitHub Action
    if len(sys.argv) > 1 and sys.argv[1] == "ql":
        ql_weather()
    else:
        # 普通运行
        main()