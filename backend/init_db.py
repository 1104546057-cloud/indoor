import os
from pathlib import Path

import pymysql
from dotenv import load_dotenv
from passlib.context import CryptContext
from pymysql.err import OperationalError as PyMySQLOperationalError
from sqlalchemy import inspect, text
from sqlalchemy.exc import OperationalError

try:
    from .database import Base, DB_HOST, DB_NAME, DB_PASSWORD, DB_PORT, DB_USER, SessionLocal, engine
    from .models import User
except ImportError:
    # 兼容直接执行 python backend/init_db.py 的场景。
    from database import Base, DB_HOST, DB_NAME, DB_PASSWORD, DB_PORT, DB_USER, SessionLocal, engine
    from models import User


# 初始化脚本读取 backend/.env，拿到数据库账号和默认管理员账号配置。
load_dotenv(Path(__file__).with_name('.env'))

# 初始化 admin 用户时，对明文密码做 bcrypt 哈希后再写入数据库。
password_context = CryptContext(schemes=['bcrypt'], deprecated='auto')


def ensure_database_exists():
    """使用 MySQL 管理员账号创建数据库、创建 dwc 用户并授权。"""

    admin_user = os.getenv('DB_ADMIN_USER')
    admin_password = os.getenv('DB_ADMIN_PASSWORD')

    # 如果没有配置 root 等管理员账号，就跳过建库授权，只尝试用已有 dwc 账号建表。
    if not admin_user or not admin_password:
        return

    try:
        connection = pymysql.connect(
            host=DB_HOST,
            port=DB_PORT,
            user=admin_user,
            password=admin_password,
            charset='utf8mb4',
            autocommit=True,
        )
    except PyMySQLOperationalError as error:
        print('Could not connect with DB_ADMIN_USER. Will try existing database user next.')
        print(error)
        return

    try:
        with connection.cursor() as cursor:
            # 创建项目数据库，utf8mb4 可以完整支持中文。
            cursor.execute(
                f'CREATE DATABASE IF NOT EXISTS `{DB_NAME}` '
                'DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci'
            )

            # 创建后端运行时使用的普通数据库用户。
            # SQL 中的 @'%%' 是为了避免 PyMySQL 把 % 当成格式化占位符。
            cursor.execute(
                f"CREATE USER IF NOT EXISTS '{DB_USER}'@'%%' IDENTIFIED BY %s",
                (DB_PASSWORD,),
            )

            # 授权 dwc 用户只访问当前项目数据库，不给它 root 级别权限。
            cursor.execute(f"GRANT ALL PRIVILEGES ON `{DB_NAME}`.* TO '{DB_USER}'@'%'")
            cursor.execute('FLUSH PRIVILEGES')
    finally:
        connection.close()


def create_tables():
    """根据 SQLAlchemy ORM 模型创建数据库表。"""

    Base.metadata.create_all(bind=engine)


def migrate_legacy_schema():
    """给 create_all 无法自动更新的旧表补充新增字段、索引和外键。

    SQLAlchemy 的 create_all 只负责创建不存在的表，不会 ALTER 已存在的表。
    早期版本的 tb_recognition_result 因此可能缺少业务关联字段。此迁移是
    幂等的：每次初始化都先检查现有结构，只添加缺失对象。
    """

    table_name = 'tb_recognition_result'
    column_definitions = {
        'inspection_record_id': 'INT NULL',
        'image_id': 'INT NULL',
        'device_item_id': 'INT NULL',
        'numeric_value': 'FLOAT NULL',
    }
    indexed_columns = {
        'inspection_record_id': 'ix_tb_recognition_result_inspection_record_id',
        'image_id': 'ix_tb_recognition_result_image_id',
        'device_item_id': 'ix_tb_recognition_result_device_item_id',
    }
    foreign_keys = {
        'inspection_record_id': (
            'fk_tb_recognition_result_inspection_record_id',
            'tb_inspection_record',
            'id',
        ),
        'image_id': (
            'fk_tb_recognition_result_image_id',
            'tb_image',
            'id',
        ),
        'device_item_id': (
            'fk_tb_recognition_result_device_item_id',
            'tb_device_item',
            'id',
        ),
    }

    with engine.begin() as connection:
        schema = inspect(connection)
        if not schema.has_table(table_name):
            return

        existing_columns = {column['name'] for column in schema.get_columns(table_name)}
        for column_name, definition in column_definitions.items():
            if column_name in existing_columns:
                continue
            connection.execute(text(
                f'ALTER TABLE `{table_name}` '
                f'ADD COLUMN `{column_name}` {definition}'
            ))
            print(f'Added column: {table_name}.{column_name}')

        # DDL 执行后重新读取结构，避免使用 Inspector 的旧缓存。
        schema = inspect(connection)
        existing_indexes = {
            tuple(index.get('column_names') or [])
            for index in schema.get_indexes(table_name)
        }
        for column_name, index_name in indexed_columns.items():
            if (column_name,) in existing_indexes:
                continue
            connection.execute(text(
                f'CREATE INDEX `{index_name}` '
                f'ON `{table_name}` (`{column_name}`)'
            ))
            print(f'Added index: {index_name}')

        schema = inspect(connection)
        existing_foreign_keys = {
            tuple(foreign_key.get('constrained_columns') or [])
            for foreign_key in schema.get_foreign_keys(table_name)
        }
        for column_name, (constraint_name, referenced_table, referenced_column) in foreign_keys.items():
            if (column_name,) in existing_foreign_keys:
                continue
            connection.execute(text(
                f'ALTER TABLE `{table_name}` '
                f'ADD CONSTRAINT `{constraint_name}` '
                f'FOREIGN KEY (`{column_name}`) '
                f'REFERENCES `{referenced_table}` (`{referenced_column}`)'
            ))
            print(f'Added foreign key: {constraint_name}')


def migrate_device_management_schema():
    """为未使用 Alembic 的旧部署补齐设备管理新增字段。"""

    definitions = {
        'tb_device_item': {
            'recognition_type': 'VARCHAR(50) NULL',
            'camera_role': 'VARCHAR(30) NULL',
            'reference_image_url': 'VARCHAR(500) NULL',
            'inspection_point_id': 'INT NULL',
        },
        'tb_robot': {
            'agent_base_url': 'VARCHAR(500) NULL',
            'ssh_host': 'VARCHAR(160) NULL',
            'camera_roles': 'JSON NULL',
            'voltage': 'FLOAT NULL',
            'last_seen_at': 'DATETIME NULL',
            'last_error': 'VARCHAR(500) NULL',
            'is_active': 'BOOLEAN NOT NULL DEFAULT TRUE',
        },
    }
    with engine.begin() as connection:
        for table_name, columns in definitions.items():
            schema = inspect(connection)
            if not schema.has_table(table_name):
                continue
            existing = {column['name'] for column in schema.get_columns(table_name)}
            for column_name, definition in columns.items():
                if column_name in existing:
                    continue
                connection.execute(text(
                    f'ALTER TABLE `{table_name}` ADD COLUMN `{column_name}` {definition}'
                ))
                print(f'Added column: {table_name}.{column_name}')


def create_admin_user():
    """创建或更新默认管理员账号。"""

    admin_username = os.getenv('ADMIN_USERNAME', 'admin')
    admin_password = os.getenv('ADMIN_PASSWORD', '123456')
    admin_nickname = os.getenv('ADMIN_NICKNAME', 'system-admin')

    db = SessionLocal()
    try:
        existing_user = db.query(User).filter(User.username == admin_username).first()
        if existing_user:
            # 如果 admin 已存在，也同步更新密码，方便修改 .env 后重新初始化。
            existing_user.password_hash = password_context.hash(admin_password)
            existing_user.nickname = admin_nickname
            existing_user.role = 'admin'
            existing_user.is_active = True
            db.commit()
            print(f'Admin user updated: {admin_username}')
            return

        admin_user = User(
            username=admin_username,
            password_hash=password_context.hash(admin_password),
            nickname=admin_nickname,
            role='admin',
            is_active=True,
        )
        db.add(admin_user)
        db.commit()
        print(f'Admin user created: {admin_username}')
    finally:
        db.close()


def init_database():
    """初始化数据库、数据表和默认管理员账号。"""

    try:
        ensure_database_exists()
        create_tables()
        migrate_legacy_schema()
        migrate_device_management_schema()
        create_admin_user()
        print('Database initialized successfully.')
    except OperationalError as error:
        print('Database initialization failed.')
        print('Please make sure MySQL is running and the database has been created.')
        print(error)
        raise


if __name__ == '__main__':
    init_database()
