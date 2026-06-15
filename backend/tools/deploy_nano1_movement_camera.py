#!/usr/bin/env python3
"""将运动板初版辅助摄像头脚本部署到 nano1，并重启服务。"""

from pathlib import Path

import paramiko

from vehicle_hosts import load_nano1

ROOT = Path(__file__).resolve().parents[2].parent / 'nano_deploy' / 'src' / 'indoor_patrol_bringup' / 'scripts'
REMOTE_DIR = '/home/nano1/indoor_patrol_ws/src/indoor_patrol_bringup/scripts'
FILES = [
    'movement_camera_mjpeg_server.py',
    'start_movement_services.sh',
]


def main():
    cfg = load_nano1()
    host = cfg['movement_host']
    user = cfg['movement_user']
    password = cfg['movement_password']
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(host, username=user, password=password, timeout=10, look_for_keys=False, allow_agent=False)

    sftp = client.open_sftp()
    for name in FILES:
        local_path = ROOT / name
        remote_path = f'{REMOTE_DIR}/{name}'
        print(f'upload {local_path.name} -> {remote_path}')
        sftp.put(str(local_path), remote_path)
        client.exec_command(f'chmod +x {remote_path}')
    sftp.close()

    start_script = f'{REMOTE_DIR}/start_movement_services.sh'
    print('run', start_script)
    _stdin, stdout, stderr = client.exec_command(f'bash -lc {start_script!r}', timeout=20)
    print(stdout.read().decode('utf-8', errors='replace').strip())
    err = stderr.read().decode('utf-8', errors='replace').strip()
    if err:
        print('stderr:', err)

    check_cmds = [
        'pgrep -af movement_camera_mjpeg_server.py || echo NO_PROC',
        'python3 - <<\'PY\'\nimport urllib.request\nprint(urllib.request.urlopen("http://127.0.0.1:8080/status", timeout=3).read().decode())\nPY',
        'tail -n 5 ~/indoor_patrol_logs/movement_camera_mjpeg.log',
    ]
    for command in check_cmds:
        print('>>>', command.split('\n', 1)[0])
        _stdin, stdout, stderr = client.exec_command(command, timeout=15)
        print(stdout.read().decode('utf-8', errors='replace').strip())
        err = stderr.read().decode('utf-8', errors='replace').strip()
        if err:
            print('stderr:', err)
        print('---')

    client.close()


if __name__ == '__main__':
    main()
