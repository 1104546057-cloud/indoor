# 后端运维工具

这些脚本用于 Nano 双板的网络配置、诊断与部署，**不参与** Web 后端运行时加载。在项目根目录或 `backend/tools/` 下执行。

## 前置条件

- 已安装 `backend/requirements.txt`（含 `paramiko`）
- 已创建 `backend/vehicles.json`（可从场景模板复制）
- 执行网络配置脚本前，电脑需能 SSH 到 Nano（通常先连实验室 WiFi）

## 网络配置

| 脚本 | 用途 |
|------|------|
| `configure_mifi_wifi.py` | 为两块 Nano 配置 MiFi WiFi 与静态 IP（`192.168.1.10/11`） |
| `configure_phone_hotspot.py` | 为两块 Nano 配置手机热点与静态 IP |
| `fix_mifi_subnet.py` | 修正 MiFi 网段配置并重新连接 |

使用前编辑脚本顶部的 `SSID`、密码、网关等常量。切换网络时加 `--switch` 参数（SSH 会断开）：

```powershell
cd backend\tools
python configure_phone_hotspot.py --switch
```

## 扫描与诊断

| 脚本 | 用途 |
|------|------|
| `scan_mifi_lan.py` | 扫描 `192.168.1.x` 网段中的 Nano |
| `scan_hotspot_lan.py` | 扫描手机热点网段中的 Nano |
| `diagnose_nano1.py` | 检查 nano1 双板摄像头服务状态 |
| `diagnose_camera_deep.py` | 深度诊断识别板摄像头 |

## 部署

| 脚本 | 用途 |
|------|------|
| `deploy_nano1_movement_camera.py` | 部署运动板摄像头服务 |
| `deploy_nano1camera_recognition.py` | 部署识别板摄像头服务 |

`vehicle_hosts.py` 从 `backend/vehicles.json` 读取 nano1 双板地址，供诊断/部署脚本共用。
