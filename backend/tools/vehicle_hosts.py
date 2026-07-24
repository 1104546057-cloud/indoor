#!/usr/bin/env python3
"""从 backend/vehicles.json 读取 nano1 双板地址。"""

import json
from pathlib import Path


def load_nano1():
    path = Path(__file__).resolve().parents[1] / 'vehicles.json'
    data = json.loads(path.read_text(encoding='utf-8'))
    vehicle = next(item for item in data['vehicles'] if item['id'] == 'nano1')
    return {
        'movement_host': vehicle['ssh_host'],
        'movement_user': vehicle['ssh_username'],
        'movement_password': vehicle['ssh_password'],
        'recognition_host': vehicle['camera_ssh_host'],
        'recognition_user': vehicle['camera_ssh_username'],
        'recognition_password': vehicle['camera_ssh_password'],
    }
