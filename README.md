# 室内巡检无人车管理平台

本项目按开发环境搭建笔记复现为前后端分离结构：

- `backend/`：FastAPI 后端服务
- `frontend/`：React + Vite 前端工程
- `docs/`：项目文档

平台支持**多台无人车（nano1、nano2…）的选择与远程控制**：在设备控制页右上角下拉选择车辆，点击“连接车”后即可对所选车辆进行实时控制并查看其摄像头画面。新增车辆只需在配置文件里追加一段，无需改代码。

## 后端启动

后端使用相对导入，需在**项目根目录**以模块方式启动（不要进入 `backend/` 再运行）。请使用你本地已装好依赖的 Python 环境（示例用 conda 环境的 `python.exe`）：

```powershell
# 1) 安装依赖
python -m pip install -r backend/requirements.txt

# 2) 在项目根目录启动后端
python -m uvicorn backend.main:app --reload --host 127.0.0.1 --port 8000
```

启动后可访问：

- `http://127.0.0.1:8000/`
- `http://127.0.0.1:8000/docs`
- `http://127.0.0.1:8000/api/health`

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
  "default_vehicle_id": "nano1",        // 默认选中的车辆
  "vehicles": [
    {
      "id": "nano1",                     // 车辆唯一标识
      "name": "巡检车 nano1",            // 下拉框显示名称
      "agent_base_url": "http://<IP>:9000",     // Nano 常驻控制 agent
      "camera_stream_url": "http://<IP>:8080/", // Nano 摄像头 MJPEG 流
      "ssh_host": "<IP>",
      "ssh_port": 22,
      "ssh_username": "nano1",
      "ssh_password": "<该车SSH密码>",
      "start_script": "/home/nano1/indoor_patrol_ws/src/indoor_patrol_bringup/scripts/start_vehicle_services.sh"
    }
    // 新增车辆：在数组里再追加一段即可
  ]
}
```

若 `vehicles.json` 不存在，后端会自动回退到 `.env` 中的单车 `VEHICLE_*` 配置。

## 前端启动

需要先安装 Node.js，并确保 `node`、`npm` 可在终端中使用：

```powershell
cd frontend
npm install
npm run dev
```

启动后访问 `http://localhost:5173/`。前端已配置 Vite 代理，`/api/*` 请求会转发到 `http://127.0.0.1:8000`。

## 车端（Jetson Nano）准备

每台车的 Jetson Nano 需要具备：

- ROS Melodic（`ros-base` + `ros-melodic-serial` + `ros-melodic-tf`）
- 编译好的 `~/indoor_patrol_ws`（含 `dlrobot_robot` 底盘驱动与 `indoor_patrol_bringup`）
- 串口 udev 规则，使底盘控制板（CH340，`1a86:55d4`）映射为 `/dev/dlrobot_controller`
- 用户加入 `dialout` 组（串口）与 `video` 组（摄像头）

网页点击“连接车”后，后端会 SSH 登录该车并执行 `start_vehicle_services.sh`，自动拉起 ROS 控制服务（端口 9000）与摄像头 MJPEG 服务（端口 8080）。

## 联调验证

1. 启动 MySQL，并完成数据库初始化。
2. 在项目根目录启动后端服务。
3. 启动前端服务。
4. 打开 `http://localhost:5173/`，使用 `admin` / `123456` 登录。
5. 进入“设备控制”页，右上角下拉选择车辆（nano1 / nano2 / nano3）→ 点击“连接车”。
6. 连接成功后可看到该车摄像头画面，并用网页方向键或键盘方向键进行实时控制。
