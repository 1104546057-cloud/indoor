# 室内巡检无人车管理平台

本项目按开发环境搭建笔记复现为前后端分离结构：

- `backend/`：FastAPI 后端服务
- `frontend/`：React + Vite 前端工程
- `docs/`：项目文档

## 后端启动

使用你本地已有的 `Env11` 虚拟环境即可。当前环境路径为 `D:\Anaconda\envs\Env11`，如果 PowerShell 无法识别 `conda`，可以直接使用该环境里的 `python.exe`：

```powershell
D:\Anaconda\envs\Env11\python.exe -m pip install -r backend/requirements.txt
D:\Anaconda\envs\Env11\python.exe -m alembic upgrade head
D:\Anaconda\envs\Env11\python.exe -m backend.init_db
D:\Anaconda\envs\Env11\python.exe -m uvicorn main:app --reload --host 127.0.0.1 --port 8000
```

启动后可访问：

- `http://127.0.0.1:8000/`
- `http://127.0.0.1:8000/docs`
- `http://127.0.0.1:8000/api/health`

## 前端启动

需要先安装 Node.js，并确保 `node`、`npm` 可在终端中使用：

```powershell
cd frontend
npm install
npm run dev
```

启动后访问 `http://localhost:5173/`。前端已配置 Vite 代理，`/api/*` 请求会转发到 `http://127.0.0.1:8000`。

## 联调验证

1. 先启动后端服务。
2. 再启动前端服务。
3. 打开 `http://localhost:5173/`，页面中的 API 状态显示为“后端 API 已连接”即表示联调成功。

## 真实车辆联调

系统只使用真实设备链路，不提供设备模式切换。在 `backend/.env` 中保持：

```env
AUTO_CREATE_TABLES=false
```

将 `backend/vehicles.example.json` 复制为 `backend/vehicles.json`，按现场网络填写每辆车的 agent、摄像头、雷达和 SSH 地址。启动前先执行 `python -m alembic upgrade head`。业务能力已归入现有模块：

1. “设备管理”维护车辆、电房、电柜、监测对象和阈值规则；
2. “巡检任务管理”维护巡检点、正式路线、任务下发、巡检记录和现场图片；
3. “室内巡检监控”展示车辆、任务、AI 结果和告警闭环；
4. “系统用户管理”维护真实账号、角色、启用状态和操作审计日志；
5. 车辆 agent 调用 `POST /api/business/tasks/{task_id}/status` 回传进度，NX 服务调用 `POST /api/recognition/results` 上报识别结果和图片。

本机自动化测试会替换网络发送函数，避免在开发机上误连车辆；产品代码中没有测试设备、异常场景或手工推进任务接口。实车验收需要车辆 agent、相机、雷达和 NX 服务处于同一可达网络。

## 验证

```powershell
python -m pytest backend/tests -q
cd frontend
npm run build
```
