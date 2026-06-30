import json
import random
import time
from datetime import datetime
from urllib import request

BACKEND_URL = 'http://127.0.0.1:8000/api/recognition/results'

SAMPLES = [
    {
        'taskId': 'task-a1',
        'robotId': 'nano1',
        'roomCode': 'HL-001',
        'cabinetCode': 'CAB-A02',
        'pointId': 'P33',
        'itemCode': 'A02-CURRENT',
        'targetName': '低压配电柜2号',
        'recognitionType': '电流表识别',
        'value': '63.2 A',
        'unit': 'A',
        'standardRange': '0 - 40 A',
        'confidence': 96.8,
        'status': '异常',
    },
    {
        'taskId': 'task-a1',
        'robotId': 'nano1',
        'roomCode': 'HL-001',
        'cabinetCode': 'CAB-A01',
        'pointId': 'P31',
        'itemCode': 'A01-VOLTAGE',
        'targetName': '低压配电柜1号',
        'recognitionType': '电压表识别',
        'value': '381.5 V',
        'unit': 'V',
        'standardRange': '360 - 400 V',
        'confidence': 98.1,
        'status': '正常',
    },
    {
        'taskId': 'task-a1',
        'robotId': 'nano1',
        'roomCode': 'HL-001',
        'cabinetCode': 'CAB-A03',
        'pointId': 'P35',
        'itemCode': 'A03-LAMP-RUN',
        'targetName': '运行指示灯',
        'recognitionType': '指示灯识别',
        'value': '绿灯亮',
        'recognition_state': 'ON',
        'standardRange': '绿灯亮',
        'confidence': 97.4,
        'status': '正常',
    },
    {
        'taskId': 'task-a1',
        'robotId': 'nano1',
        'roomCode': 'HL-001',
        'cabinetCode': 'CAB-A04',
        'pointId': 'P38',
        'itemCode': 'A04-HANDLE-BREAKER',
        'targetName': '断路器手柄',
        'recognitionType': '手柄状态识别',
        'value': '合闸',
        'recognition_state': 'CLOSE',
        'standardRange': '合闸',
        'confidence': 95.6,
        'status': '正常',
    },
]


def post_result(payload):
    payload = dict(payload)
    payload['capturedAt'] = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
    payload['imageUrl'] = payload.get('imageUrl') or 'http://nx-demo.local/images/demo.jpg'
    data = json.dumps(payload, ensure_ascii=False).encode('utf-8')
    req = request.Request(BACKEND_URL, data=data, headers={'Content-Type': 'application/json'})
    with request.urlopen(req, timeout=5) as response:
        return json.loads(response.read().decode('utf-8'))
def main():
    print('Start simulating NX inference results. Press Ctrl+C to stop.')
    while True:
        sample = random.choice(SAMPLES)
        try:
            result = post_result(sample)
            saved = result.get('result', {})
            print(f"OK: {saved.get('targetName')} / {saved.get('recognitionType')} / {saved.get('value')} / {saved.get('status')}")
        except Exception as error:
            print(f'POST failed: {error}')
        time.sleep(5)


if __name__ == '__main__':
    main()
