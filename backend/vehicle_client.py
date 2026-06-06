import json
import os
import time
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

import paramiko
from dotenv import load_dotenv
from fastapi import HTTPException


# 车辆连接配置放在 backend/.env，避免 Nano 地址变化时改代码。
load_dotenv(Path(__file__).with_name('.env'))

VEHICLE_AGENT_BASE_URL = os.getenv(
    'VEHICLE_AGENT_BASE_URL',
    'http://192.168.31.139:9000',
).rstrip('/')
VEHICLE_CAMERA_STREAM_URL = os.getenv(
    'VEHICLE_CAMERA_STREAM_URL',
    'http://192.168.31.139:8080/',
)
VEHICLE_REQUEST_TIMEOUT = float(os.getenv('VEHICLE_REQUEST_TIMEOUT', '1.5'))
VEHICLE_SSH_HOST = os.getenv('VEHICLE_SSH_HOST', '192.168.31.139')
VEHICLE_SSH_PORT = int(os.getenv('VEHICLE_SSH_PORT', '22'))
VEHICLE_SSH_USERNAME = os.getenv('VEHICLE_SSH_USERNAME', 'nano1')
VEHICLE_SSH_PASSWORD = os.getenv('VEHICLE_SSH_PASSWORD', '123456')
VEHICLE_START_SCRIPT = os.getenv(
    'VEHICLE_START_SCRIPT',
    '/home/nano1/indoor_patrol_ws/src/indoor_patrol_bringup/scripts/start_vehicle_services.sh',
)
VEHICLE_START_TIMEOUT = float(os.getenv('VEHICLE_START_TIMEOUT', '8'))
VEHICLE_CONNECT_RETRIES = int(os.getenv('VEHICLE_CONNECT_RETRIES', '10'))
VEHICLE_CONNECT_RETRY_DELAY = float(os.getenv('VEHICLE_CONNECT_RETRY_DELAY', '0.8'))


def _agent_json_request(path: str, method: str = 'GET', payload: dict | None = None):
    """Call the Nano vehicle_agent HTTP API and return parsed JSON."""

    url = f'{VEHICLE_AGENT_BASE_URL}{path}'
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


def send_vehicle_command(linear_x: float, angular_z: float, acceleration: float | None = None):
    """Send a velocity command to the Nano resident agent."""

    payload = {
        'linear_x': linear_x,
        'angular_z': angular_z,
    }
    if acceleration is not None:
        payload['acceleration'] = acceleration
    return _agent_json_request('/cmd_vel', method='POST', payload=payload)


def stop_vehicle():
    """Ask the Nano resident agent to publish zero velocity."""

    return _agent_json_request('/stop', method='POST')


def get_vehicle_status():
    """Read vehicle agent status, including voltage and odometry when available."""

    return _agent_json_request('/status')


def get_camera_info():
    """Return the current camera stream URL used by the frontend."""

    return {
        'stream_url': VEHICLE_CAMERA_STREAM_URL,
        'cache': 'no-store',
    }


def _check_camera_status():
    """Check whether the MJPEG service has opened the camera and produced frames."""

    status_url = VEHICLE_CAMERA_STREAM_URL.rstrip('/') + '/status'
    request = Request(status_url, headers={'Accept': 'application/json'}, method='GET')
    try:
        with urlopen(request, timeout=VEHICLE_REQUEST_TIMEOUT) as response:
            body = response.read().decode('utf-8')
            return json.loads(body) if body else {'online': True}
    except (HTTPError, URLError, TimeoutError, json.JSONDecodeError):
        return {'online': False}


def start_vehicle_services():
    """SSH into the Nano and start both ROS control and camera streaming services."""

    command = (
        "bash -lc "
        + json.dumps(
            f'chmod +x {VEHICLE_START_SCRIPT} && {VEHICLE_START_SCRIPT}',
            ensure_ascii=True,
        )
    )

    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())

    try:
        client.connect(
            hostname=VEHICLE_SSH_HOST,
            port=VEHICLE_SSH_PORT,
            username=VEHICLE_SSH_USERNAME,
            password=VEHICLE_SSH_PASSWORD,
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
            agent_status = get_vehicle_status()
        except HTTPException:
            agent_status = {'online': False}

        camera_status = _check_camera_status()
        if agent_status.get('online') and camera_status.get('has_frame'):
            break

        time.sleep(VEHICLE_CONNECT_RETRY_DELAY)

    return {
        'message': '车辆服务启动命令已下发',
        'script_output': output,
        'agent': agent_status,
        'camera': camera_status,
        'camera_stream_url': VEHICLE_CAMERA_STREAM_URL,
    }
