# 室内巡检无人车管理平台

本项目按开发环境搭建笔记复现为前后端分离结构：

- `backend/`：FastAPI 后端服务
- `frontend/`：React + Vite 前端工程
- `docs/`：项目文档

平台支持**多台无人车（nano1、nano2、nano3…）的选择与远程控制**：在设备控制页选择车辆，点击“连接车”后即可对所选车辆进行实时控制并查看摄像头画面。新增车辆只需在配置文件里追加一段，无需改代码。

**nano1 双板架构**：运动板负责底盘控制与辅助摄像头，识别板负责 4K 识别摄像头；连接时会分别 SSH 到两块 Nano 启动对应服务。

## 后端启动

后端使用相对导入，需在**项目根目录**以模块方式启动（不要进入 `backend/` 再运行）。请使用你本地已装好依赖的 Python 环境：

```powershell
# 1) 安装依赖
python -m pip install -r backend/requirements.txt

# 2) 在项目根目录启动后端（端口需与 frontend/vite.config.js 中 proxy 一致）
python -m uvicorn backend.main:app --reload --host 127.0.0.1 --port 8001
```

启动后可访问：

- `http://127.0.0.1:8001/`
- `http://127.0.0.1:8001/docs`
- `http://127.0.0.1:8001/api/health`

## 环境变量配置

复制 `backend/.env.example` 为 `backend/.env`，按本机实际情况填写：

- `DB_*`：MySQL 连接与初始化账号（`DB_ADMIN_*` 用于首次建库建用户，需填本机 MySQL root 密码）
- `ADMIN_*`：平台登录账号（默认 `admin` / `123456`）
- `JWT_*`：登录令牌配置
- `VEHICLE_*`：当未提供多车注册表时的**单车回退配置**

## 数据库初始化（首次部署）

确保本机 MySQL 服务已启动，并在 `backend/.env` 中正确填写 `DB_ADMIN_USER` / `DB_ADMIN_PASSWORD`（MySQL 管理员账号），然后在项目根目录执行一次：

```powershell
python -m backend.init_db
```

该脚本会创建数据库 `devices_web_control`、运行时账号 `dwc`，以及默认登录用户 `admin`。只需初始化一次。

## 多车注册表配置

多车信息由 `backend/vehicles.json` 提供（含 SSH 凭据，已加入 `.gitignore`，不入库）。首次使用请复制模板并按实际车辆填写：

```powershell
copy backend\vehicles.example.json backend\vehicles.json
```

`vehicles.json` 结构说明：

```jsonc
{
  "default_vehicle_id": "nano1",
  "vehicles": [
    {
      "id": "nano1",
      "name": "巡检车 nano1（双板）",
      "agent_base_url": "http://<运动板IP>:9000",
      "movement_camera_stream_url": "http://<运动板IP>:8080/",
      "camera_stream_url": "http://<识别板IP>:8080/",
      "ssh_host": "<运动板IP>",
      "ssh_port": 22,
      "ssh_username": "nano1",
      "ssh_password": "<运动板SSH密码>",
      "start_script": "/home/nano1/indoor_patrol_ws/src/indoor_patrol_bringup/scripts/start_movement_services.sh",
      "camera_ssh_host": "<识别板IP>",
      "camera_ssh_port": 22,
      "camera_ssh_username": "nano1camera",
      "camera_ssh_password": "<识别板SSH密码>",
      "camera_start_script": "/home/nano1camera/camera_preview/start_camera_services.sh",
      "camera_defaults": { "width": 3840, "height": 2160, "fps": 30, "jpeg_quality": 95 }
    },
    {
      "id": "nano2",
      "name": "巡检车 nano2",
      "agent_base_url": "http://<IP>:9000",
      "camera_stream_url": "http://<IP>:8080/",
      "ssh_host": "<IP>",
      "ssh_port": 22,
      "ssh_username": "nano2",
      "ssh_password": "<该车SSH密码>",
      "start_script": "/home/nano2/indoor_patrol_ws/src/indoor_patrol_bringup/scripts/start_vehicle_services.sh"
    }
    // 新增车辆：在数组里再追加一段即可
  ]
}
```

若 `vehicles.json` 不存在，后端会自动回退到 `.env` 中的单车 `VEHICLE_*` 配置。

修改 `vehicles.json` 后需**重启后端**，配置在启动时加载。

### 按场景快速复制注册表

仓库提供多套场景模板，按当前网络环境复制其一为 `vehicles.json` 并填写 SSH 密码：

```powershell
# 通用模板（需自行填 IP）
copy backend\vehicles.example.json backend\vehicles.json

# 实验室 WiFi（192.168.31.x）
copy backend\vehicles.lab.json backend\vehicles.json

# MiFi 实地（192.168.1.x）
copy backend\vehicles.mifi.json backend\vehicles.json

# 手机热点（按模板网段修改 IP）
copy backend\vehicles.hotspot.json backend\vehicles.json
```

### 常见网络场景（nano1 双板 IP 示例）

| 场景 | 运动板 IP | 识别板 IP | 说明 |
|------|-----------|-----------|------|
| 实验室 WiFi | `192.168.31.139` | `192.168.31.200` | 电脑与两块 Nano 连同一实验室网络 |
| MiFi 实地 | `192.168.1.10` | `192.168.1.11` | 电脑与 Nano 连同一 MiFi |
| 手机热点 | `10.178.84.10` | `10.178.84.11` | 按手机热点实际网段填写，网关以 `ipconfig` 为准 |

**前提**：电脑与两块 Nano 必须处于同一局域网，且 IP 与 `vehicles.json` 一致。

切换 Nano 网络（MiFi / 手机热点）可使用 `backend/tools/` 下的配置脚本，详见 `backend/tools/README.md`。

## 从 Git 克隆后的完整启动流程

```powershell
git clone https://github.com/1104546057-cloud/indoor.git
cd indoor

# 1. 后端依赖
python -m pip install -r backend/requirements.txt

# 2. 环境变量
copy backend\.env.example backend\.env
# 编辑 backend\.env 填写 MySQL 与本机配置

# 3. 初始化数据库（首次）
python -m backend.init_db

# 4. 车辆注册表（按场景选一个）
copy backend\vehicles.lab.json backend\vehicles.json
# 编辑 vehicles.json 填写 SSH 密码

# 5. 启动后端（项目根目录）
python -m uvicorn backend.main:app --reload --host 127.0.0.1 --port 8001

# 6. 启动前端（新终端）
cd frontend
npm install
npm run dev
```

浏览器访问 `http://localhost:5173/`，登录 `admin` / `123456` 后即可使用。

需要先安装 Node.js，并确保 `node`、`npm` 可在终端中使用：

```powershell
cd frontend
npm install
npm run dev
```

启动后访问 `http://localhost:5173/`。前端已配置 Vite 代理，`/api/*` 请求会转发到 `http://127.0.0.1:8001`。

## 车端（Jetson Nano）准备

每台车的 Jetson Nano 需要具备：

- ROS Melodic（`ros-base` + `ros-melodic-serial` + `ros-melodic-tf`）
- 编译好的 `~/indoor_patrol_ws`（含 `dlrobot_robot` 底盘驱动与 `indoor_patrol_bringup`）
- 串口 udev 规则，使底盘控制板（CH340，`1a86:55d4`）映射为 `/dev/dlrobot_controller`
- 用户加入 `dialout` 组（串口）与 `video` 组（摄像头）

**nano1 双板分工**：

| 板子 | 用户 | 职责 | 端口 |
|------|------|------|------|
| 运动板 | `nano1` | 底盘 agent + 运动辅助摄像头 | 9000 / 8080 |
| 识别板 | `nano1camera` | 4K 识别摄像头 MJPEG | 8080 |

网页点击“连接车”后，后端会 SSH 登录对应 Nano 并执行启动脚本，拉起控制与摄像头服务。

**nano2 / nano3（单板）**：一块 Nano 同时承担控制与摄像头，使用 `start_vehicle_services.sh` 即可。

## 设备控制页功能

- **手动控制**：方向键 / 键盘控制底盘，查看运动板辅助摄像头
- **目标识别**：查看识别板 4K 摄像头，支持分辨率/帧率/画质调节与单帧抓拍下载
- **急停**：发送零速度命令，车端 agent 也有超时自动停车保护

## 联调验证

1. 启动 MySQL，并完成数据库初始化。
2. 确认电脑与目标车辆处于同一网络，且 `vehicles.json` IP 正确。
3. 在项目根目录启动后端服务（端口 `8001`）。
4. 启动前端服务。
5. 打开 `http://localhost:5173/`，使用 `admin` / `123456` 登录。
6. 进入“设备控制”页，选择车辆 → 点击“连接车”。
7. 连接成功后检查运动摄像头、识别摄像头、底盘控制与急停。

### 常见问题

- **登录后无法控制 / 连接异常**：可能是 Cookie 过期，清空浏览器缓存后重新登录；或在浏览器控制台执行 `localStorage.clear(); sessionStorage.clear(); location.href='/login';`
- **改了 vehicles.json 不生效**：重启 uvicorn 后端进程。
- **后端端口被占用**：检查 `netstat -ano | findstr ":8001"`，结束旧进程后重新启动。
