import json
import os
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from dotenv import load_dotenv
from fastapi import HTTPException


load_dotenv(Path(__file__).with_name('.env'))

RECOGNITION_REQUEST_TIMEOUT = float(os.getenv('RECOGNITION_REQUEST_TIMEOUT', '1.5'))
_DEVICES_FILE = Path(__file__).with_name('vision_devices.json')


def _load_registry():
    if not _DEVICES_FILE.exists():
        return {}, None

    with _DEVICES_FILE.open('r', encoding='utf-8') as handle:
        data = json.load(handle)

    devices = {item['id']: item for item in data.get('devices', [])}
    default_id = data.get('default_device_id') or (next(iter(devices)) if devices else None)
    return devices, default_id


def _resolve_device(device_id):
    devices, default_id = _load_registry()
    target_id = device_id or default_id
    if not target_id or target_id not in devices:
        raise HTTPException(status_code=404, detail=f'recognition device not found: {target_id}')
    return devices[target_id]


def _join_url(base_url, path):
    return base_url.rstrip('/') + '/' + path.lstrip('/')


def _request_json(url, method='GET', payload=None):
    data = None
    headers = {'Accept': 'application/json'}
    if payload is not None:
        data = json.dumps(payload).encode('utf-8')
        headers['Content-Type'] = 'application/json'
    request = Request(url, data=data, headers=headers, method=method)
    try:
        with urlopen(request, timeout=RECOGNITION_REQUEST_TIMEOUT) as response:
            body = response.read().decode('utf-8')
            return json.loads(body) if body else {}
    except HTTPError as error:
        detail = error.read().decode('utf-8', errors='replace')
        raise HTTPException(status_code=error.code, detail=detail or str(error)) from error
    except (URLError, TimeoutError) as error:
        raise HTTPException(status_code=503, detail=f'recognition service unavailable: {error}') from error
    except json.JSONDecodeError as error:
        raise HTTPException(status_code=502, detail='recognition service returned non-JSON data') from error


def _public_device(device):
    inference_node = device.get('inference_node') or {}
    return {
        'id': device['id'],
        'name': device.get('name', device['id']),
        'role': device.get('role', 'recognition_camera'),
        'camera_base_url': device.get('camera_base_url', ''),
        'stream_url': f"/api/recognition/stream?device_id={device['id']}",
        'inference_node': {
            'id': inference_node.get('id'),
            'name': inference_node.get('name'),
            'base_url': inference_node.get('base_url'),
            'report_target': inference_node.get('report_target'),
        },
    }


def list_recognition_devices():
    devices, default_id = _load_registry()
    return {
        'default_device_id': default_id,
        'devices': [_public_device(device) for device in devices.values()],
    }


def get_recognition_status(device_id):
    device = _resolve_device(device_id)
    camera_status = _request_json(_join_url(device['camera_base_url'], device.get('status_path', '/status')))

    inference_status = None
    inference_node = device.get('inference_node') or {}
    if inference_node.get('base_url'):
        inference_status = _request_json(
            _join_url(inference_node['base_url'], inference_node.get('status_path', '/status'))
        )

    return {
        'device': _public_device(device),
        'camera': camera_status,
        'inference': inference_status,
    }


def get_recognition_detections(device_id):
    device = _resolve_device(device_id)
    detections = _request_json(_join_url(device['camera_base_url'], device.get('detections_path', '/detections')))
    detections['device_id'] = device['id']
    return detections


def capture_recognition(device_id, payload=None):
    device = _resolve_device(device_id)
    capture_payload = payload.copy() if payload else {}
    capture_payload.setdefault('device_id', device['id'])
    result = _request_json(
        _join_url(device['camera_base_url'], device.get('capture_path', '/capture')),
        method='POST',
        payload=capture_payload,
    )
    result['device_id'] = device['id']
    return result


def open_recognition_stream(device_id):
    device = _resolve_device(device_id)
    stream_url = _join_url(device['camera_base_url'], device.get('stream_path', '/stream'))
    request = Request(
        stream_url,
        headers={
            'Accept': 'multipart/x-mixed-replace,image/*,*/*',
            'Cache-Control': 'no-cache',
        },
        method='GET',
    )
    try:
        return urlopen(request, timeout=RECOGNITION_REQUEST_TIMEOUT)
    except (HTTPError, URLError, TimeoutError) as error:
        raise HTTPException(status_code=503, detail=f'unable to open recognition stream: {error}') from error
