#!/usr/bin/env python3
"""修正 MiFi 静态 IP 网段（192.168.1.x）并重新连接 WiFi。"""

import json
import sys
import time

import paramiko

MIFI_SSID = 'YOUR_MIFI_SSID'
MIFI_PASSWORD = 'YOUR_MIFI_PASSWORD'
MIFI_GATEWAY = '192.168.1.1'
MIFI_PREFIX = 24
MIFI_DNS = '192.168.1.1'
CONN_NAME = 'mifi-4063-static'

BOARDS = [
    {
        'label': 'movement',
        'user': 'nano1',
        'password': '123456',
        'static_ip': '192.168.1.10',
        'try_hosts': ['192.168.1.10', '192.168.0.10', '192.168.31.139'],
    },
    {
        'label': 'recognition',
        'user': 'nano1camera',
        'password': '123456',
        'static_ip': '192.168.1.11',
        'try_hosts': ['192.168.1.11', '192.168.0.11', '192.168.31.200'],
    },
]


def run(client, command, timeout=40, sudo=False, sudo_password='123456'):
    if sudo:
        command = f'echo {json.dumps(sudo_password)} | sudo -S bash -lc {json.dumps(command)}'
    _stdin, stdout, stderr = client.exec_command(command, timeout=timeout)
    return stdout.read().decode('utf-8', errors='replace').strip(), stderr.read().decode('utf-8', errors='replace').strip()


def connect_board(board):
    last_error = None
    for host in board['try_hosts']:
        client = paramiko.SSHClient()
        client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
        try:
            client.connect(
                host,
                username=board['user'],
                password=board['password'],
                timeout=6,
                look_for_keys=False,
                allow_agent=False,
            )
            print(f"{board['label']}: connected via {host}")
            return client, host
        except Exception as error:
            last_error = error
            continue
    raise RuntimeError(f"{board['label']}: 所有地址均不可达 ({last_error})")


def fix_board(board):
    static_ip = board['static_ip']
    pwd = board['password']
    client, via = connect_board(board)

    cmds = [
        f'nmcli connection delete "{CONN_NAME}" 2>/dev/null || true',
        f'nmcli connection add type wifi con-name "{CONN_NAME}" ifname wlan0 ssid "{MIFI_SSID}"',
        f'nmcli connection modify "{CONN_NAME}" wifi-sec.key-mgmt wpa-psk wifi-sec.psk "{MIFI_PASSWORD}"',
        f'nmcli connection modify "{CONN_NAME}" ipv4.addresses {static_ip}/{MIFI_PREFIX} ipv4.gateway {MIFI_GATEWAY} ipv4.dns "{MIFI_DNS}" ipv4.method manual',
        f'nmcli connection modify "{CONN_NAME}" connection.autoconnect yes connection.autoconnect-priority 100',
        f'nmcli connection up "{CONN_NAME}" ifname wlan0',
    ]
    for cmd in cmds:
        out, err = run(client, cmd, sudo=True, sudo_password=pwd)
        if err and 'Error' in err:
            client.close()
            raise RuntimeError(err)

    time.sleep(3)
    ip_out, _ = run(client, 'ip -4 addr show wlan0 | grep inet || true')
    client.close()
    print(f"{board['label']}: fixed via {via}, wlan0 -> {ip_out or static_ip}")
    return True


def main():
    results = []
    for board in BOARDS:
        try:
            fix_board(board)
            results.append((board['label'], True))
        except Exception as error:
            print(f"FAILED {board['label']}: {error}")
            results.append((board['label'], False))

    print('\nSUMMARY:', json.dumps({
        'movement_ip': '192.168.1.10',
        'recognition_ip': '192.168.1.11',
        'gateway': MIFI_GATEWAY,
        'results': results,
    }, ensure_ascii=False, indent=2))
    return 0 if all(item[1] for item in results) else 1


if __name__ == '__main__':
    sys.exit(main())
