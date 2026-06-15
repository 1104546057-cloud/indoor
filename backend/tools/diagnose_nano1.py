#!/usr/bin/env python3
import paramiko

from vehicle_hosts import load_nano1

CMDS = [
    'ls -l /dev/video* 2>/dev/null || echo NO_VIDEO',
    'pgrep -af movement_camera_mjpeg_server || pgrep -af camera_mjpeg_server || echo NO_CAM_PROC',
    'python3 - <<\'PY\'\nimport urllib.request\nprint(urllib.request.urlopen("http://127.0.0.1:8080/status", timeout=3).read().decode())\nPY',
]


def run_board(label, host, user, password):
    print(f'===== {label} @ {host} =====')
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(host, username=user, password=password, timeout=8, look_for_keys=False, allow_agent=False)
    for command in CMDS:
        print('>>>', command.split('\n', 1)[0])
        _stdin, stdout, stderr = client.exec_command(command, timeout=12)
        out = stdout.read().decode('utf-8', errors='replace').strip()
        err = stderr.read().decode('utf-8', errors='replace').strip()
        print(out or err or '(empty)')
        print('---')
    client.close()


if __name__ == '__main__':
    cfg = load_nano1()
    boards = [
        ('movement', cfg['movement_host'], cfg['movement_user'], cfg['movement_password']),
        ('recognition', cfg['recognition_host'], cfg['recognition_user'], cfg['recognition_password']),
    ]
    for label, host, user, password in boards:
        try:
            run_board(label, host, user, password)
        except Exception as error:
            print(f'===== {label} @ {host} FAILED: {error} =====')
