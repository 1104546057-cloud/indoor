import json
import os
import time
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

import paramiko
from dotenv import load_dotenv
from fastapi import HTTPException


# 车辆连接配置：多车注册表放在 backend/vehicles.json，全局超时等参数仍放 .env。
load_dotenv(Path(__file__).with_name('.env'))

VEHICLE_REQUEST_TIMEOUT = float(os.getenv('VEHICLE_REQUEST_TIMEOUT', '1.5'))
VEHICLE_CAPTURE_TIMEOUT = float(os.getenv('VEHICLE_CAPTURE_TIMEOUT', '12'))
VEHICLE_START_TIMEOUT = float(os.getenv('VEHICLE_START_TIMEOUT', '8'))
VEHICLE_CONNECT_RETRIES = int(os.getenv('VEHICLE_CONNECT_RETRIES', '15'))
VEHICLE_CONNECT_RETRY_DELAY = float(os.getenv('VEHICLE_CONNECT_RETRY_DELAY', '1.0'))

_VEHICLES_FILE = Path(__file__).with_name('vehicles.json')

DEFAULT_CAMERA_PROFILES = [
    {'label': '4K 60fps', 'width': 3840, 'height': 2160, 'fps_options': [60, 30, 25, 23, 20, 15, 10]},
    {'label': '4K 30fps', 'width': 3840, 'height': 2160, 'fps_options': [30, 25, 23, 20, 15, 10]},
    {'label': '2.5K', 'width': 2560, 'height': 1440, 'fps_options': [60, 30, 25, 23, 20, 15, 10]},
    {'label': '1080p', 'width': 1920, 'height': 1080, 'fps_options': [60, 30, 25, 23, 20, 15, 10]},
    {'label': '720p', 'width': 1280, 'height': 720, 'fps_options': [60, 30, 25, 23, 20, 15, 10]},
    {'label': 'VGA', 'width': 640, 'height': 480, 'fps_options': [60, 30, 25, 23, 20, 15, 10]},
]


def _load_registry():
    """加载多车注册表。

    优先读取 vehicles.json；如果文件不存在，则回退到 .env 中的单车配置，
    保证旧部署仍可用。
    """

    if _VEHICLES_FILE.exists():
        with _VEHICLES_FILE.open('r', encoding='utf-8') as handle:
            data = json.load(handle)
        vehicles = {item['id']: item for item in data.get('vehicles', [])}
        default_id = data.get('default_vehicle_id')
        if not default_id and vehicles:
            default_id = next(iter(vehicles))
        return vehicles, default_id

    fallback = {
        'id': 'default',
        'name': '巡检车',
        'agent_base_url': os.getenv('VEHICLE_AGENT_BASE_URL', 'http://192.168.1.10:9000'),
        'camera_stream_url': os.getenv('VEHICLE_CAMERA_STREAM_URL', 'http://192.168.1.10:8080/'),
        'ssh_host': os.getenv('VEHICLE_SSH_HOST', '192.168.1.10'),
        'ssh_port': int(os.getenv('VEHICLE_SSH_PORT', '22')),
        'ssh_username': os.getenv('VEHICLE_SSH_USERNAME', 'nano1'),
        'ssh_password': os.getenv('VEHICLE_SSH_PASSWORD', '123456'),
        'start_script': os.getenv(
            'VEHICLE_START_SCRIPT',
            '/home/nano1/indoor_patrol_ws/src/indoor_patrol_bringup/scripts/start_vehicle_services.sh',
        ),
    }
    return {'default': fallback}, 'default'


_VEHICLES, _DEFAULT_VEHICLE_ID = _load_registry()


def _refresh_registry():
    """每次请求前重读 vehicles.json，避免改配置后必须重启后端。"""
    global _VEHICLES, _DEFAULT_VEHICLE_ID
    _VEHICLES, _DEFAULT_VEHICLE_ID = _load_registry()


def _is_dual_board(vehicle):
    return bool(vehicle.get('camera_ssh_host'))


def _host_from_url(url: str) -> str:
    if '://' not in url:
        return ''
    return url.split('//', 1)[1].split(':', 1)[0].strip()


def _build_stream_url(host: str, port: int = 8080) -> str:
    host = (host or '').strip()
    if not host:
        return ''
    return f'http://{host}:{int(port)}/'


def _movement_camera_stream_url(vehicle):
    """手动控制页：运动板 USB 辅助摄像头（双板时绝不回退到 4K 识别流）。"""
    explicit = (vehicle.get('movement_camera_stream_url') or '').strip()
    if explicit:
        return explicit

    if _is_dual_board(vehicle):
        host = vehicle.get('ssh_host') or _host_from_url(vehicle.get('agent_base_url', ''))
        port = int(vehicle.get('movement_camera_port', 8080))
        derived = _build_stream_url(host, port)
        if derived:
            return derived

    return vehicle['camera_stream_url']


def _recognition_camera_stream_url(vehicle):
    """目标识别页：4K 识别摄像头流地址。"""
    explicit = (vehicle.get('recognition_camera_stream_url') or vehicle.get('camera_stream_url') or '').strip()
    if explicit:
        return explicit

    if _is_dual_board(vehicle):
        host = vehicle.get('camera_ssh_host') or _host_from_url(explicit or vehicle.get('camera_stream_url', ''))
        port = int(vehicle.get('recognition_camera_port', 8080))
        derived = _build_stream_url(host, port)
        if derived:
            return derived

    return vehicle['camera_stream_url']


def _camera_defaults(vehicle):
    defaults = vehicle.get('camera_defaults') or {}
    return {
        'width': int(defaults.get('width', 3840)),
        'height': int(defaults.get('height', 2160)),
        'fps': int(defaults.get('fps', 30)),
        'jpeg_quality': int(defaults.get('jpeg_quality', 95)),
    }


def list_vehicles():
    """返回前端用的车辆列表（不含密码等敏感字段）。"""

    _refresh_registry()
    items = []
    for vehicle in _VEHICLES.values():
        items.append({
            'id': vehicle['id'],
            'name': vehicle.get('name', vehicle['id']),
            'ssh_host': vehicle.get('ssh_host', ''),
            'dual_board': _is_dual_board(vehicle),
            'movement_host': vehicle.get('ssh_host', ''),
            'camera_host': (
                vehicle.get('camera_ssh_host')
                or vehicle['camera_stream_url'].split('//')[1].split(':')[0]
                if '://' in vehicle.get('camera_stream_url', '')
                else ''
            ),
        })
    return {
        'default_vehicle_id': _DEFAULT_VEHICLE_ID,
        'vehicles': items,
    }


def _resolve_vehicle(vehicle_id: str | None):
    """根据 vehicle_id 找到车辆配置；为空时使用默认车。"""

    _refresh_registry()
    target_id = vehicle_id or _DEFAULT_VEHICLE_ID
    vehicle = _VEHICLES.get(target_id)
    if vehicle is None:
        raise HTTPException(status_code=404, detail=f'未找到车辆：{target_id}')
    return vehicle


def _agent_json_request(vehicle, path: str, method: str = 'GET', payload: dict | None = None):
    """调用指定车辆 Nano 上的 vehicle_agent HTTP API，并返回解析后的 JSON。"""

    base_url = vehicle['agent_base_url'].rstrip('/')
    url = f'{base_url}{path}'
    data = None
    headers = {'Accept': 'application/json'}
    if payload is not None:
        data = json.dumps(payload).encode('utf-8')
        headers['Content-Type'] = 'application/json'

    request = Request(url, data=data, headers=headers, method=method)

    try:
        with urlopen(request, timeout=VEHICLE_REQUEST_TIMEOUT) as response:
            body = response.read().decode('utf-8')
            return json.loads(body) if body else {}
    except HTTPError as error:
        detail = error.read().decode('utf-8', errors='replace')
        raise HTTPException(
            status_code=502,
            detail=f'车辆 agent 返回错误：HTTP {error.code} {detail}',
        ) from error
    except URLError as error:
        raise HTTPException(
            status_code=503,
            detail=f'无法连接车辆 agent：{error.reason}',
        ) from error
    except TimeoutError as error:
        raise HTTPException(status_code=504, detail='连接车辆 agent 超时') from error
    except json.JSONDecodeError as error:
        raise HTTPException(status_code=502, detail='车辆 agent 返回了非 JSON 数据') from error


def _camera_base_url(vehicle, *, recognition=True):
    url = _recognition_camera_stream_url(vehicle) if recognition else _movement_camera_stream_url(vehicle)
    return url.rstrip('/')


def _camera_json_request(
    vehicle,
    path: str,
    method: str = 'GET',
    payload: dict | None = None,
    *,
    recognition=True,
):
    base_url = _camera_base_url(vehicle, recognition=recognition)
    url = f'{base_url}{path}'
    data = None
    headers = {'Accept': 'application/json'}
    if payload is not None:
        data = json.dumps(payload).encode('utf-8')
        headers['Content-Type'] = 'application/json'

    request = Request(url, data=data, headers=headers, method=method)
    try:
        with urlopen(request, timeout=VEHICLE_REQUEST_TIMEOUT) as response:
            body = response.read().decode('utf-8')
            return json.loads(body) if body else {}
    except HTTPError as error:
        detail = error.read().decode('utf-8', errors='replace')
        raise HTTPException(
            status_code=502,
            detail=f'摄像头服务返回错误：HTTP {error.code} {detail}',
        ) from error
    except URLError as error:
        raise HTTPException(
            status_code=503,
            detail=f'无法连接摄像头服务：{error.reason}',
        ) from error
    except TimeoutError as error:
        raise HTTPException(status_code=504, detail='连接摄像头服务超时') from error
    except json.JSONDecodeError as error:
        raise HTTPException(status_code=502, detail='摄像头服务返回了非 JSON 数据') from error


def send_vehicle_command(vehicle_id, linear_x, angular_z, acceleration=None):
    """向指定车辆 Nano 上的常驻 agent 下发速度命令。"""

    vehicle = _resolve_vehicle(vehicle_id)
    payload = {
        'linear_x': linear_x,
        'angular_z': angular_z,
    }
    if acceleration is not None:
        payload['acceleration'] = acceleration
    return _agent_json_request(vehicle, '/cmd_vel', method='POST', payload=payload)


def stop_vehicle(vehicle_id):
    """让指定车辆 Nano 上的常驻 agent 发布零速度。"""

    vehicle = _resolve_vehicle(vehicle_id)
    return _agent_json_request(vehicle, '/stop', method='POST')


def get_vehicle_status(vehicle_id):
    """读取指定车辆 agent 状态，包括电压和里程计（如可用）。"""

    vehicle = _resolve_vehicle(vehicle_id)
    return _agent_json_request(vehicle, '/status')


def _fetch_camera_profiles(vehicle):
    try:
        data = _camera_json_request(vehicle, '/profiles', recognition=True)
        return data.get('profiles') or DEFAULT_CAMERA_PROFILES
    except HTTPException:
        return vehicle.get('camera_profiles') or DEFAULT_CAMERA_PROFILES


def get_movement_camera_info(vehicle_id):
    """返回手动控制页用的运动板辅助摄像头地址。"""
    vehicle = _resolve_vehicle(vehicle_id)
    stream_url = _movement_camera_stream_url(vehicle)
    status = _check_camera_status(vehicle, recognition=False)
    return {
        'vehicle_id': vehicle['id'],
        'camera_role': 'movement',
        'stream_url': stream_url,
        'cache': 'no-store',
        'dual_board': _is_dual_board(vehicle),
        'movement_host': vehicle.get('ssh_host', ''),
        'recognition_stream_url': _recognition_camera_stream_url(vehicle),
        'status': status,
    }


def get_camera_info(vehicle_id):
    """返回目标识别页用的 4K 摄像头流地址与参数。"""

    vehicle = _resolve_vehicle(vehicle_id)
    defaults = _camera_defaults(vehicle)
    status = _check_camera_status(vehicle, recognition=True)
    profiles = _fetch_camera_profiles(vehicle)

    return {
        'vehicle_id': vehicle['id'],
        'camera_role': 'recognition',
        'stream_url': _recognition_camera_stream_url(vehicle),
        'movement_stream_url': _movement_camera_stream_url(vehicle),
        'snapshot_url': f"{_camera_base_url(vehicle, recognition=True)}/snapshot",
        'cache': 'no-store',
        'dual_board': _is_dual_board(vehicle),
        'movement_host': vehicle.get('ssh_host', ''),
        'camera_host': vehicle.get('camera_ssh_host', ''),
        'defaults': defaults,
        'profiles': profiles,
        'settings': {
            'width': status.get('width') or status.get('actual_width') or defaults['width'],
            'height': status.get('height') or status.get('actual_height') or defaults['height'],
            'fps': status.get('fps') or int(status.get('actual_fps') or defaults['fps']),
            'jpeg_quality': status.get('jpeg_quality') or defaults['jpeg_quality'],
            'actual_width': status.get('actual_width'),
            'actual_height': status.get('actual_height'),
            'actual_fps': status.get('actual_fps'),
        },
        'status': status,
    }


def apply_camera_settings(vehicle_id, width, height, fps, jpeg_quality):
    vehicle = _resolve_vehicle(vehicle_id)
    payload = {
        'width': int(width),
        'height': int(height),
        'fps': int(fps),
        'jpeg_quality': int(jpeg_quality),
    }
    result = _camera_json_request(vehicle, '/settings', method='POST', payload=payload, recognition=True)
    return {
        'vehicle_id': vehicle['id'],
        'stream_url': _recognition_camera_stream_url(vehicle),
        'settings': result,
    }


def capture_recognition_photo(vehicle_id):
    """从 4K 识别摄像头抓取一帧 JPEG。"""
    vehicle = _resolve_vehicle(vehicle_id)
    url = f"{_camera_base_url(vehicle, recognition=True)}/snapshot"
    request = Request(url, headers={'Accept': 'image/jpeg'}, method='GET')
    try:
        with urlopen(request, timeout=VEHICLE_CAPTURE_TIMEOUT) as response:
            content_type = (response.headers.get('Content-Type') or 'image/jpeg').lower()
            if 'multipart' in content_type:
                raise HTTPException(
                    status_code=502,
                    detail='识别摄像头缺少 /snapshot 接口，请在 nano1camera 上更新 camera_mjpeg_server.py',
                )
            if 'json' in content_type:
                detail = response.read().decode('utf-8', errors='replace')
                raise HTTPException(
                    status_code=502,
                    detail=f'识别摄像头暂无可拍画面：{detail or "no frame"}',
                )
            body = response.read(20 * 1024 * 1024)
            if not body:
                raise HTTPException(status_code=502, detail='摄像头返回空图片')
            return body, content_type.split(';')[0].strip() or 'image/jpeg'
    except HTTPError as error:
        detail = error.read().decode('utf-8', errors='replace')
        raise HTTPException(
            status_code=502,
            detail=f'拍照失败：HTTP {error.code} {detail}',
        ) from error
    except URLError as error:
        raise HTTPException(
            status_code=503,
            detail=f'无法连接识别摄像头：{error.reason}',
        ) from error
    except TimeoutError as error:
        raise HTTPException(status_code=504, detail='识别摄像头拍照超时') from error


def _check_camera_status(vehicle, *, recognition=True):
    """检查 MJPEG 服务是否已经打开摄像头并出帧。"""

    try:
        return _camera_json_request(vehicle, '/status', recognition=recognition)
    except HTTPException:
        return {'online': False, 'has_frame': False}


def _ssh_run_script(host, port, username, password, script):
    command = (
        "bash -lc "
        + json.dumps(
            f'chmod +x {script} && {script}',
            ensure_ascii=True,
        )
    )

    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())

    try:
        client.connect(
            hostname=host,
            port=int(port),
            username=username,
            password=password,
            timeout=VEHICLE_START_TIMEOUT,
            banner_timeout=VEHICLE_START_TIMEOUT,
            auth_timeout=VEHICLE_START_TIMEOUT,
            look_for_keys=False,
            allow_agent=False,
        )
        _stdin, stdout, stderr = client.exec_command(command, timeout=VEHICLE_START_TIMEOUT)
        exit_code = stdout.channel.recv_exit_status()
        output = stdout.read().decode('utf-8', errors='replace').strip()
        error_output = stderr.read().decode('utf-8', errors='replace').strip()
    except paramiko.AuthenticationException as error:
        raise HTTPException(status_code=502, detail=f'{host} SSH 认证失败，请检查账号密码') from error
    except (paramiko.SSHException, OSError, TimeoutError) as error:
        raise HTTPException(status_code=503, detail=f'无法通过 SSH 连接 {host}：{error}') from error
    finally:
        client.close()

    if exit_code != 0:
        detail = error_output or output or f'exit code {exit_code}'
        raise HTTPException(status_code=502, detail=f'{host} 启动脚本执行失败：{detail}')

    return output or error_output


def start_vehicle_services(vehicle_id):
    """SSH 启动车辆服务。双板架构会分别启动运动板与摄像头板。"""

    vehicle = _resolve_vehicle(vehicle_id)
    outputs = []

    movement_output = _ssh_run_script(
        vehicle['ssh_host'],
        vehicle.get('ssh_port', 22),
        vehicle['ssh_username'],
        vehicle['ssh_password'],
        vehicle['start_script'],
    )
    outputs.append({'board': 'movement', 'host': vehicle['ssh_host'], 'output': movement_output})

    if _is_dual_board(vehicle):
        camera_output = _ssh_run_script(
            vehicle['camera_ssh_host'],
            vehicle.get('camera_ssh_port', 22),
            vehicle['camera_ssh_username'],
            vehicle['camera_ssh_password'],
            vehicle['camera_start_script'],
        )
        outputs.append({
            'board': 'camera',
            'host': vehicle['camera_ssh_host'],
            'output': camera_output,
        })

    agent_status = {'online': False}
    movement_camera_status = {'online': False, 'has_frame': False}
    recognition_camera_status = {'online': False, 'has_frame': False}
    for _index in range(VEHICLE_CONNECT_RETRIES):
        try:
            agent_status = _agent_json_request(vehicle, '/status')
        except HTTPException:
            agent_status = {'online': False}

        movement_camera_status = _check_camera_status(vehicle, recognition=False)
        recognition_camera_status = _check_camera_status(vehicle, recognition=True)
        if _is_dual_board(vehicle):
            if agent_status.get('online') and movement_camera_status.get('has_frame') and recognition_camera_status.get('has_frame'):
                break
            if agent_status.get('online') and movement_camera_status.get('has_frame'):
                # 辅助摄像头已就绪即可继续，4K 识别板可稍后出图。
                if _index >= VEHICLE_CONNECT_RETRIES - 1:
                    break
        elif agent_status.get('online') and movement_camera_status.get('has_frame'):
            recognition_camera_status = movement_camera_status
            break

        time.sleep(VEHICLE_CONNECT_RETRY_DELAY)

    message = '车辆服务启动命令已下发'
    if _is_dual_board(vehicle):
        message = '双板服务已启动：运动控制板 + 4K 识别摄像头板'

    return {
        'vehicle_id': vehicle['id'],
        'message': message,
        'dual_board': _is_dual_board(vehicle),
        'boards': outputs,
        'agent': agent_status,
        'camera': recognition_camera_status,
        'movement_camera': movement_camera_status,
        'movement_camera_stream_url': _movement_camera_stream_url(vehicle),
        'camera_stream_url': _recognition_camera_stream_url(vehicle),
        'movement_host': vehicle.get('ssh_host', ''),
        'camera_host': vehicle.get('camera_ssh_host', ''),
        'camera_settings': get_camera_info(vehicle['id']).get('settings', {}),
    }
