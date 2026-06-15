#!/usr/bin/env python3
"""将 4K 识别摄像头服务部署到 nano1camera 并重启。"""

from pathlib import Path

import paramiko

from vehicle_hosts import load_nano1

ROOT = Path(__file__).resolve().parents[2].parent
CAMERA_SCRIPT = ROOT / 'nano1camera_deploy' / 'camera_mjpeg_server.py'
START_SCRIPT_LOCAL = ROOT / 'nano1camera_deploy' / 'start_camera_services.sh'
REMOTE_DIR = '/home/nano1camera/camera_preview'


def main():
    cfg = load_nano1()
    host = cfg['recognition_host']
    user = cfg['recognition_user']
    password = cfg['recognition_password']
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(host, username=user, password=password, timeout=10, look_for_keys=False, allow_agent=False)

    client.exec_command(f'mkdir -p {REMOTE_DIR}/logs')
    sftp = client.open_sftp()
    for local_path, remote_name in [
        (CAMERA_SCRIPT, 'camera_mjpeg_server.py'),
        (START_SCRIPT_LOCAL, 'start_camera_services.sh'),
    ]:
        remote_path = f'{REMOTE_DIR}/{remote_name}'
        print(f'upload {local_path.name} -> {remote_path}')
        sftp.put(str(local_path), remote_path)
        client.exec_command(f'chmod +x {remote_path}')
    sftp.close()

    start_script = f'{REMOTE_DIR}/start_camera_services.sh'
    print('run', start_script)
    _stdin, stdout, stderr = client.exec_command(f'bash -lc {start_script!r}', timeout=20)
    print(stdout.read().decode('utf-8', errors='replace').strip())
    err = stderr.read().decode('utf-8', errors='replace').strip()
    if err:
        print('stderr:', err)

    check_cmds = [
        'pgrep -af camera_mjpeg_server.py || echo NO_PROC',
        'python3 - <<\'PY\'\nimport urllib.request\nresp = urllib.request.urlopen("http://127.0.0.1:8080/snapshot", timeout=8)\nprint(resp.headers.get("Content-Type"), len(resp.read()))\nPY',
        'tail -n 8 ~/camera_preview/logs/camera_mjpeg_server.log',
    ]
    for command in check_cmds:
        print('>>>', command.split('\n', 1)[0])
        _stdin, stdout, stderr = client.exec_command(command, timeout=20)
        print(stdout.read().decode('utf-8', errors='replace').strip())
        err = stderr.read().decode('utf-8', errors='replace').strip()
        if err:
            print('stderr:', err)
        print('---')

    client.close()


if __name__ == '__main__':
    main()
