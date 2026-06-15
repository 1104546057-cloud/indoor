#!/usr/bin/env python3
"""为两块 Nano 配置手机热点 WiFi 连接与静态 IP。"""

import json
import sys
import time

import paramiko

# 使用前按手机热点实际情况修改以下常量（网关可用电脑连热点后 ipconfig 查看）
HOTSPOT_SSID = 'YOUR_HOTSPOT_SSID'
HOTSPOT_PASSWORD = 'YOUR_HOTSPOT_PASSWORD'
HOTSPOT_GATEWAY = '10.178.84.233'
HOTSPOT_PREFIX = 24
HOTSPOT_DNS = '10.178.84.233'
CONN_NAME = 'phone-hotspot-static'

BOARDS = [
    {
        'label': 'movement',
        'user': 'nano1',
        'password': '123456',
        'static_ip': '10.178.84.10',
        'hosts': [
            '192.168.31.139',
            '192.168.1.10',
            '10.178.84.10',
        ],
    },
    {
        'label': 'recognition',
        'user': 'nano1camera',
        'password': '123456',
        'static_ip': '10.178.84.11',
        'hosts': [
            '192.168.31.200',
            '192.168.1.11',
            '10.178.84.11',
        ],
    },
]


def run(client, command, timeout=40, sudo=False, sudo_password='123456'):
    if sudo:
        command = f'echo {json.dumps(sudo_password)} | sudo -S bash -lc {json.dumps(command)}'
    _stdin, stdout, stderr = client.exec_command(command, timeout=timeout)
    out = stdout.read().decode('utf-8', errors='replace').strip()
    err = stderr.read().decode('utf-8', errors='replace').strip()
    return out, err


def connect_board(board):
    last_error = None
    for host in board['hosts']:
        client = paramiko.SSHClient()
        client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
        try:
            client.connect(
                host,
                username=board['user'],
                password=board['password'],
                timeout=8,
                look_for_keys=False,
                allow_agent=False,
            )
            return client, host
        except Exception as error:
            last_error = error
    raise last_error or RuntimeError('无法连接任何候选地址')


def configure_board(board, switch_now=False):
    label = board['label']
    static_ip = board['static_ip']
    print(f'\n===== {label} -> {static_ip} =====')

    client, connected_host = connect_board(board)
    print('connected via', connected_host)

    pwd = board['password']
    run(client, 'nmcli dev wifi rescan || true', sudo=True, sudo_password=pwd)
    time.sleep(2)
    scan, _ = run(
        client,
        f'nmcli -t -f SSID,SIGNAL dev wifi list | grep -F "{HOTSPOT_SSID}" || true',
        sudo=True,
        sudo_password=pwd,
    )
    print('hotspot scan:', scan or '(未扫到热点，请把手机放在 Nano 附近)')

    active, _ = run(client, 'nmcli -t -f NAME,DEVICE connection show --active', sudo=True, sudo_password=pwd)
    print('active connections:', active)

    run(client, f'nmcli connection delete "{CONN_NAME}" 2>/dev/null || true', sudo=True, sudo_password=pwd)

    cmds = [
        f'nmcli connection add type wifi con-name "{CONN_NAME}" ifname wlan0 ssid "{HOTSPOT_SSID}"',
        f'nmcli connection modify "{CONN_NAME}" wifi-sec.key-mgmt wpa-psk wifi-sec.psk "{HOTSPOT_PASSWORD}"',
        f'nmcli connection modify "{CONN_NAME}" ipv4.addresses {static_ip}/{HOTSPOT_PREFIX} ipv4.gateway {HOTSPOT_GATEWAY} ipv4.dns "{HOTSPOT_DNS}" ipv4.method manual',
        f'nmcli connection modify "{CONN_NAME}" connection.autoconnect yes connection.autoconnect-priority 100',
    ]
    for cmd in cmds:
        out, err = run(client, cmd, sudo=True, sudo_password=pwd)
        if err and 'Error' in err and 'No such' not in err:
            client.close()
            raise RuntimeError(err)

    print('profile created OK')

    if switch_now:
        print('switching to phone hotspot (SSH 将断开)...')
        run(client, f'nmcli connection up "{CONN_NAME}" ifname wlan0', timeout=15, sudo=True, sudo_password=pwd)
    else:
        out, err = run(
            client,
            f'nmcli connection up "{CONN_NAME}" ifname wlan0',
            timeout=30,
            sudo=True,
            sudo_password=pwd,
        )
        print('connect try:', out or err)
        time.sleep(4)
        ip_out, _ = run(client, 'ip -4 addr show wlan0')
        print('wlan0 ip:', ip_out)

    client.close()
    return True


def main():
    switch = '--switch' in sys.argv
    results = []
    for board in BOARDS:
        try:
            configure_board(board, switch_now=switch)
            results.append((board['label'], True))
        except Exception as error:
            print(f'FAILED {board["label"]}: {error}')
            results.append((board['label'], False))

    print('\nSUMMARY:', json.dumps({
        'ssid': HOTSPOT_SSID,
        'gateway': HOTSPOT_GATEWAY,
        'movement_ip': '10.178.84.10',
        'recognition_ip': '10.178.84.11',
        'results': results,
        'next_step': f'电脑连接 {HOTSPOT_SSID} 热点后 ping 上述 IP',
    }, ensure_ascii=False, indent=2))
    return 0 if all(r[1] for r in results) else 1


if __name__ == '__main__':
    sys.exit(main())
