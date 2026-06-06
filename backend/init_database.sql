-- 创建项目专用数据库，utf8mb4 用于完整支持中文字符。
CREATE DATABASE IF NOT EXISTS devices_web_control
  DEFAULT CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

-- 创建后端运行时使用的普通数据库用户。
CREATE USER IF NOT EXISTS 'dwc'@'%' IDENTIFIED BY 'dwc@123';

-- 只给 dwc 授权访问本项目数据库，避免后端使用 root 权限。
GRANT ALL PRIVILEGES ON devices_web_control.* TO 'dwc'@'%';
FLUSH PRIVILEGES;
