#!/usr/bin/env python3
"""扫描 MiFi 局域网内 SSH 可达的 Nano 板。"""

import socket
import paramiko

SUBNET = '192.168.1'
USERS = [('nano1', '123456'), ('nano1camera', '123456')]


def port_open(ip, port, timeout=0.4):
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    sock.settimeout(timeout)
    try:
        return sock.connect_ex((ip, port)) == 0
    finally:
        sock.close()


def try_ssh(ip, user, password):
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(ip, username=user, password=password, timeout=4, look_for_keys=False, allow_agent=False)
    _stdin, stdout, _stderr = client.exec_command('hostname && ip -4 addr show wlan0 | grep inet', timeout=6)
    info = stdout.read().decode('utf-8', errors='replace').strip()
    client.close()
    return info


def main():
    found = []
    for last in range(2, 255):
        ip = f'{SUBNET}.{last}'
        if not port_open(ip, 22):
            continue
        for user, pwd in USERS:
            try:
                info = try_ssh(ip, user, pwd)
                print(f'FOUND {ip} as {user}: {info}')
                found.append((ip, user, info))
                break
            except Exception:
                continue
    print('TOTAL:', len(found))


if __name__ == '__main__':
    main()
