from __future__ import annotations

import json
import os
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
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
VEHICLE_STATUS_CACHE_TTL = float(os.getenv('VEHICLE_STATUS_CACHE_TTL', '6'))

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
_REGISTRY_LOCK = threading.RLock()
_PROBE_LOCK = threading.Lock()
_STATUS_CACHE = {}


def _save_registry():
    """将内存中的车辆配置原子写回本机注册表。"""

    payload = {
        'default_vehicle_id': _DEFAULT_VEHICLE_ID,
        'vehicles': list(_VEHICLES.values()),
    }
    _VEHICLES_FILE.parent.mkdir(parents=True, exist_ok=True)
    temporary = _VEHICLES_FILE.with_suffix('.json.tmp')
    with temporary.open('w', encoding='utf-8') as handle:
        json.dump(payload, handle, ensure_ascii=False, indent=2)
        handle.write('\n')
    os.replace(temporary, _VEHICLES_FILE)


def upsert_vehicle_registry(vehicle_id: str, values: dict):
    """新增或更新车辆连接配置；未传入的敏感字段沿用原值。"""

    global _DEFAULT_VEHICLE_ID
    clean_id = (vehicle_id or '').strip()
    if not clean_id:
        raise HTTPException(status_code=400, detail='车辆编号不能为空')
    with _REGISTRY_LOCK:
        current = dict(_VEHICLES.get(clean_id, {}))
        current.update({key: value for key, value in values.items() if value is not None})
        current['id'] = clean_id
        current.setdefault('name', clean_id)
        if not current.get('agent_base_url'):
            raise HTTPException(status_code=400, detail='车辆 agent 地址不能为空')
        _VEHICLES[clean_id] = current
        if not _DEFAULT_VEHICLE_ID:
            _DEFAULT_VEHICLE_ID = clean_id
        _STATUS_CACHE.pop(clean_id, None)
        _save_registry()
    return sanitized_vehicle_config(current)


def remove_vehicle_registry(vehicle_id: str):
    """从连接注册表移除车辆；调用方负责业务引用检查。"""

    global _DEFAULT_VEHICLE_ID
    with _REGISTRY_LOCK:
        if vehicle_id not in _VEHICLES:
            raise HTTPException(status_code=404, detail='车辆不存在')
        _VEHICLES.pop(vehicle_id)
        _STATUS_CACHE.pop(vehicle_id, None)
        if _DEFAULT_VEHICLE_ID == vehicle_id:
            _DEFAULT_VEHICLE_ID = next(iter(_VEHICLES), None)
        _save_registry()


def sanitized_vehicle_config(vehicle: dict):
    """返回可安全发送给前端的连接配置。"""

    return {
        'id': vehicle['id'],
        'name': vehicle.get('name', vehicle['id']),
        'agent_base_url': vehicle.get('agent_base_url', ''),
        'ssh_host': vehicle.get('ssh_host', ''),
        'ssh_port': vehicle.get('ssh_port', 22),
        'ssh_username': vehicle.get('ssh_username', ''),
        'start_script': vehicle.get('start_script', ''),
        'camera_streams': dict(vehicle.get('camera_streams') or {}),
        'camera_roles': [
            role
            for role in ('movement', 'high', 'middle', 'low', 'ptz')
            if _camera_stream_url(vehicle, role)
        ],
    }


def list_vehicles(force_refresh: bool = False):
    """返回前端用的车辆列表（不含密码等敏感字段），并附带独立在线状态。"""

    now = time.monotonic()
    with _REGISTRY_LOCK:
        vehicle_snapshot = [dict(vehicle) for vehicle in _VEHICLES.values()]
    stale = [
        vehicle for vehicle in vehicle_snapshot
        if force_refresh
        or vehicle['id'] not in _STATUS_CACHE
        or now - _STATUS_CACHE[vehicle['id']]['cached_at'] >= VEHICLE_STATUS_CACHE_TTL
    ]
    if stale:
        # 同一时刻只允许一个请求刷新心跳，避免前端多个页面轮询形成探测风暴。
        with _PROBE_LOCK:
            now = time.monotonic()
            targets = [
                vehicle for vehicle in stale
                if force_refresh
                or vehicle['id'] not in _STATUS_CACHE
                or now - _STATUS_CACHE[vehicle['id']]['cached_at'] >= VEHICLE_STATUS_CACHE_TTL
            ]
            if targets:
                with ThreadPoolExecutor(max_workers=min(8, len(targets))) as executor:
                    futures = {executor.submit(_probe_vehicle_status, vehicle): vehicle['id'] for vehicle in targets}
                    for future in as_completed(futures):
                        vehicle_id = futures[future]
                        try:
                            result = future.result()
                        except Exception as exc:  # 单车探测异常不能拖垮整批车辆状态接口
                            result = {
                                'online': False,
                                'status': 'offline',
                                'error': f'状态探测异常：{exc}',
                                'last_seen_at': None,
                            }
                        _STATUS_CACHE[vehicle_id] = {**result, 'cached_at': time.monotonic()}

    items = []
    for vehicle in vehicle_snapshot:
        status = _STATUS_CACHE.get(vehicle['id']) or {
            'online': False,
            'status': 'offline',
            'error': '尚未完成状态探测',
        }
        config = sanitized_vehicle_config(vehicle)
        items.append({
            **config,
            'online': status['online'],
            'status': status['status'],
            'voltage': status.get('voltage'),
            'battery': status.get('battery'),
            'last_seen_at': status.get('last_seen_at'),
            'checked_at': status.get('checked_at'),
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
        checked_at = datetime.now().astimezone().isoformat(timespec='seconds')
        return {
            'online': bool(status.get('online')),
            'status': 'online' if status.get('online') else 'offline',
            'voltage': status.get('voltage'),
            'battery': status.get('battery'),
            'last_seen_at': checked_at,
            'checked_at': checked_at,
        }
    except HTTPException as error:
        checked_at = datetime.now().astimezone().isoformat(timespec='seconds')
        return {
            'online': False,
            'status': 'offline',
            'error': str(error.detail),
            'last_seen_at': (_STATUS_CACHE.get(vehicle['id']) or {}).get('last_seen_at'),
            'checked_at': checked_at,
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
            # 车端明确返回的 4xx（例如 execution_id 不存在）应原样转发，
            # 这样监控页可以区分“旧任务”与“车辆网关故障”。
            status_code=error.code if 400 <= error.code < 500 else 502,
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


def send_navigation_goal(vehicle_id, goal):
    """Forward a map-frame navigation goal to the selected vehicle agent."""

    vehicle = _resolve_vehicle(vehicle_id)
    path = vehicle.get('navigation_goal_path', '/navigation_goal')
    return _agent_json_request(vehicle, path, method='POST', payload=goal)


def send_navigation_route(vehicle_id, route):
    """Forward an ordered list of map-frame navigation goals to the selected vehicle agent."""

    vehicle = _resolve_vehicle(vehicle_id)
    path = vehicle.get('navigation_route_path', '/navigation_route')
    # 不降级为连续发送多个单点目标。只有车端路线执行器才能在前一点
    # SUCCEEDED 后再发送下一点，并提供可信的逐点到达确认。
    return _agent_json_request(vehicle, path, method='POST', payload=route)


def get_navigation_route_status(vehicle_id, execution_id=None):
    """Read the authoritative ordered-route state from the selected vehicle."""

    vehicle = _resolve_vehicle(vehicle_id)
    path = vehicle.get('navigation_route_status_path', '/navigation_route/status')
    if execution_id:
        path = f"{path}?{urlencode({'execution_id': execution_id})}"
    status = _agent_json_request(vehicle, path)
    return {
        'vehicle_id': vehicle['id'],
        'navigation': status,
    }


def cancel_navigation_route(vehicle_id, execution_id=None):
    """Cancel the active move_base route on the selected vehicle."""

    vehicle = _resolve_vehicle(vehicle_id)
    path = vehicle.get('navigation_route_cancel_path', '/navigation_route/cancel')
    payload = {'execution_id': execution_id} if execution_id else {}
    status = _agent_json_request(vehicle, path, method='POST', payload=payload)
    return {
        'vehicle_id': vehicle['id'],
        'navigation': status,
    }


def stop_vehicle(vehicle_id):
    """让指定车辆 Nano 上的常驻 agent 发布零速度。"""

    vehicle = _resolve_vehicle(vehicle_id)
    return _agent_json_request(vehicle, '/stop', method='POST')


def get_vehicle_status(vehicle_id):
    """读取指定车辆 agent 状态，包括电压和里程计（如可用）。"""

    vehicle = _resolve_vehicle(vehicle_id)
    return _agent_json_request(vehicle, '/status')


def _camera_stream_url(vehicle, camera_role=None):
    role = camera_role or 'inspection'
    configured_streams = vehicle.get('camera_streams') or {}
    if configured_streams.get(role):
        return configured_streams[role]
    if role in {'movement', 'primary'}:
        return vehicle.get('movement_camera_stream_url') or vehicle.get('camera_stream_url')
    if role == 'inspection':
        return vehicle.get('camera_stream_url')
    return vehicle.get(f'{role}_camera_stream_url')


def get_camera_info(vehicle_id, camera_role=None):
    """返回前端用的指定车辆摄像头流地址。"""

    vehicle = _resolve_vehicle(vehicle_id)
    source_stream_url = _camera_stream_url(vehicle, camera_role)
    query = {'vehicle_id': vehicle['id']}
    if camera_role:
        query['camera_role'] = camera_role
    stream_path = f"/api/vehicle/camera/stream?{urlencode(query)}"
    return {
        'vehicle_id': vehicle['id'],
        'camera_role': camera_role or 'inspection',
        'available_camera_roles': [
            role
            for role in ('movement', 'high', 'middle', 'low', 'ptz')
            if _camera_stream_url(vehicle, role)
        ],
        'configured': bool(source_stream_url),
        'stream_url': stream_path if source_stream_url else None,
        'source_stream_url': source_stream_url,
        'cache': 'no-store',
    }


def open_camera_stream(vehicle_id, camera_role=None):
    """打开指定车辆摄像头 MJPEG 流，供 FastAPI 以同源代理方式转发。"""

    vehicle = _resolve_vehicle(vehicle_id)
    source_stream_url = _camera_stream_url(vehicle, camera_role)
    if not source_stream_url:
        raise HTTPException(
            status_code=404,
            detail=f'车辆 {vehicle["id"]} 尚未配置摄像头角色：{camera_role or "inspection"}',
        )
    request = Request(
        source_stream_url,
        headers={
            'Accept': 'multipart/x-mixed-replace,image/*,*/*',
            'Cache-Control': 'no-cache',
        },
        method='GET',
    )
    try:
        return urlopen(request, timeout=VEHICLE_REQUEST_TIMEOUT)
    except (HTTPError, URLError, TimeoutError) as error:
        raise HTTPException(status_code=503, detail=f'无法连接摄像头视频流：{error}') from error


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
