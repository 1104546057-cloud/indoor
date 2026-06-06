# 室内巡检无人车管理平台

本项目按开发环境搭建笔记复现为前后端分离结构：

- `backend/`：FastAPI 后端服务
- `frontend/`：React + Vite 前端工程
- `docs/`：项目文档

## 后端启动

使用你本地已有的 `Env11` 虚拟环境即可。当前环境路径为 `D:\Anaconda\envs\Env11`，如果 PowerShell 无法识别 `conda`，可以直接使用该环境里的 `python.exe`：

```powershell
D:\Anaconda\envs\Env11\python.exe -m pip install -r backend/requirements.txt
cd backend
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
