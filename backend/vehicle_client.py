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
VEHICLE_START_TIMEOUT = float(os.getenv('VEHICLE_START_TIMEOUT', '8'))
VEHICLE_CONNECT_RETRIES = int(os.getenv('VEHICLE_CONNECT_RETRIES', '10'))
VEHICLE_CONNECT_RETRY_DELAY = float(os.getenv('VEHICLE_CONNECT_RETRY_DELAY', '0.8'))

_VEHICLES_FILE = Path(__file__).with_name('vehicles.json')


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

    # 回退：用旧的 .env 单车变量拼出一台车。
    fallback = {
        'id': 'default',
        'name': '巡检车',
        'agent_base_url': os.getenv('VEHICLE_AGENT_BASE_URL', 'http://192.168.31.139:9000'),
        'camera_stream_url': os.getenv('VEHICLE_CAMERA_STREAM_URL', 'http://192.168.31.139:8080/'),
        'ssh_host': os.getenv('VEHICLE_SSH_HOST', '192.168.31.139'),
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


def list_vehicles():
    """返回前端用的车辆列表（不含密码等敏感字段），并附带独立在线状态。"""

    items = []
    for vehicle in _VEHICLES.values():
        status = _probe_vehicle_status(vehicle)
        items.append({
            'id': vehicle['id'],
            'name': vehicle.get('name', vehicle['id']),
            'ssh_host': vehicle.get('ssh_host', ''),
            'online': status['online'],
            'status': status['status'],
            'voltage': status.get('voltage'),
            'error': status.get('error'),
        })
    return {
        'default_vehicle_id': _DEFAULT_VEHICLE_ID,
        'vehicles': items,
    }


def _probe_vehicle_status(vehicle):
    """轻量探测单台车是否在线；失败只标记该车离线，不抛出影响其他车辆。"""

    try:
        status = _agent_json_request(vehicle, '/status')
        return {
            'online': bool(status.get('online')),
            'status': 'online' if status.get('online') else 'offline',
            'voltage': status.get('voltage'),
        }
    except HTTPException as error:
        return {
            'online': False,
            'status': 'offline',
            'error': str(error.detail),
        }


def _resolve_vehicle(vehicle_id: str | None):
    """根据 vehicle_id 找到车辆配置；为空时使用默认车。"""

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


def get_camera_info(vehicle_id):
    """返回前端用的指定车辆摄像头流地址。"""

    vehicle = _resolve_vehicle(vehicle_id)
    return {
        'vehicle_id': vehicle['id'],
        'stream_url': vehicle['camera_stream_url'],
        'cache': 'no-store',
    }


def get_lidar_info(vehicle_id):
    """返回前端用的指定车辆雷达 WebSocket 地址。"""

    vehicle = _resolve_vehicle(vehicle_id)
    ws_url = vehicle.get('lidar_ws_url')
    if not ws_url:
        host = vehicle.get('ssh_host', '')
        ws_url = f'ws://{host}:8090/ws/lidar' if host else ''

    return {
        'vehicle_id': vehicle['id'],
        'ws_url': ws_url,
        'topic': vehicle.get('lidar_topic', '/lidar/scan'),
    }


def _check_camera_status(vehicle):
    """检查指定车辆的 MJPEG 服务是否已经打开摄像头并出帧。"""

    status_url = vehicle['camera_stream_url'].rstrip('/') + '/status'
    request = Request(status_url, headers={'Accept': 'application/json'}, method='GET')
    try:
        with urlopen(request, timeout=VEHICLE_REQUEST_TIMEOUT) as response:
            body = response.read().decode('utf-8')
            return json.loads(body) if body else {'online': True}
    except (HTTPError, URLError, TimeoutError, json.JSONDecodeError):
        return {'online': False}


def start_vehicle_services(vehicle_id):
    """SSH 登录指定车辆 Nano，启动 ROS 控制服务与摄像头流服务。"""

    vehicle = _resolve_vehicle(vehicle_id)
    start_script = vehicle['start_script']

    command = (
        "bash -lc "
        + json.dumps(
            f'chmod +x {start_script} && {start_script}',
            ensure_ascii=True,
        )
    )

    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())

    try:
        client.connect(
            hostname=vehicle['ssh_host'],
            port=int(vehicle.get('ssh_port', 22)),
            username=vehicle['ssh_username'],
            password=vehicle['ssh_password'],
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
        raise HTTPException(status_code=502, detail='Nano SSH 认证失败，请检查账号密码') from error
    except (paramiko.SSHException, OSError, TimeoutError) as error:
        raise HTTPException(status_code=503, detail=f'无法通过 SSH 连接 Nano：{error}') from error
    finally:
        client.close()

    if exit_code != 0:
        detail = error_output or output or f'exit code {exit_code}'
        raise HTTPException(status_code=502, detail=f'Nano 启动脚本执行失败：{detail}')

    agent_status = {'online': False}
    camera_status = {'online': False}
    for _index in range(VEHICLE_CONNECT_RETRIES):
        try:
            agent_status = _agent_json_request(vehicle, '/status')
        except HTTPException:
            agent_status = {'online': False}

        camera_status = _check_camera_status(vehicle)
        if agent_status.get('online') and camera_status.get('has_frame'):
            break

        time.sleep(VEHICLE_CONNECT_RETRY_DELAY)

    return {
        'vehicle_id': vehicle['id'],
        'message': '车辆服务启动命令已下发',
        'script_output': output,
        'agent': agent_status,
        'camera': camera_status,
        'camera_stream_url': vehicle['camera_stream_url'],
    }
