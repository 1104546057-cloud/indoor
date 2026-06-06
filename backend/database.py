import os
from pathlib import Path
from urllib.parse import quote_plus

from dotenv import load_dotenv
from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, sessionmaker


# 读取 backend/.env 中的数据库连接配置。
load_dotenv(Path(__file__).with_name('.env'))

# 后端连接数据库时优先使用 .env 中的值；如果没配置，就使用后面的默认值。
DB_USER = os.getenv('DB_USER', 'dwc')
DB_PASSWORD = os.getenv('DB_PASSWORD', 'dwc@123')
DB_HOST = os.getenv('DB_HOST', '127.0.0.1')
DB_PORT = int(os.getenv('DB_PORT', '3306'))
DB_NAME = os.getenv('DB_NAME', 'devices_web_control')

# 密码中可能包含 @ 等特殊字符，所以需要 quote_plus 编码后再拼接连接地址。
DATABASE_URL = (
    f'mysql+pymysql://{DB_USER}:{quote_plus(DB_PASSWORD)}'
    f'@{DB_HOST}:{DB_PORT}/{DB_NAME}?charset=utf8mb4'
)

# 创建 SQLAlchemy 数据库连接引擎和连接池。
engine = create_engine(
    DATABASE_URL,
    echo=False,
    pool_size=5,
    max_overflow=10,
    pool_pre_ping=True,
    pool_recycle=3600,
)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


# 所有 ORM 数据表模型都继承 Base，例如 models.py 中的 User。
class Base(DeclarativeBase):
    pass


# FastAPI 接口通过 Depends(get_db) 获取数据库会话，请求结束后自动关闭。
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
