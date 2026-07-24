#!/usr/bin/env python3
import time

import paramiko

from vehicle_hosts import load_nano1

LOGS = {
    'movement': '~/indoor_patrol_logs/movement_camera_mjpeg.log',
    'recognition': '~/camera_preview/logs/camera_mjpeg_server.log',
}


def run_board(label, host, user, password):
    log_path = LOGS[label]
    print(f'===== {label} @ {host} =====')
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(host, username=user, password=password, timeout=8, look_for_keys=False, allow_agent=False)
    time.sleep(2)
    for cmd in [
        'pgrep -af mjpeg_server.py || echo NO_PROC',
        'ss -ltnp | grep 8080 || netstat -ltnp 2>/dev/null | grep 8080 || echo NO_PORT',
        f'tail -n 20 {log_path}',
    ]:
        print('>>>', cmd.split('\n', 1)[0])
        _stdin, stdout, stderr = client.exec_command(cmd, timeout=20)
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
