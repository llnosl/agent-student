# 第六章：数据库 MySQL

## 2. SQL 基础

SQL 是操作关系型数据库的统一语言。

### SQL 分类

| 分类 | 作用 | 常用命令 | 使用场景 |
| --- | --- | --- | --- |
| DDL | 定义数据库对象 | `CREATE`、`ALTER`、`DROP` | 创建或修改表结构 |
| DML | 增删改数据 | `INSERT`、`UPDATE`、`DELETE` | 维护表中的记录 |
| DQL | 查询数据 | `SELECT` | 检索业务数据 |
| DCL | 控制访问权限 | `GRANT`、`REVOKE` | 管理数据库用户权限 |

### 最小案例

```sql
-- DDL：创建表
CREATE TABLE student (
    id INT PRIMARY KEY,
    name VARCHAR(20),
    age INT
);

-- DML：新增、修改、删除
INSERT INTO student (id, name, age) VALUES (1, '张三', 18);
UPDATE student SET age = 19 WHERE id = 1;
DELETE FROM student WHERE id = 1;

-- DQL：查询
SELECT id, name, age FROM student WHERE age >= 18;
```

**使用场景：**创建学生表后录入学生，并查询所有成年学生。

### 注意事项

- `UPDATE` 和 `DELETE` 通常必须带 `WHERE`，否则会影响整张表。
- 字符串和日期一般使用单引号包裹。
- SQL 关键字不区分大小写，但推荐大写以便阅读。

> 暂记：当前先区分四类 SQL 并会写基础增删改查；连接查询、子查询、索引和事务后续学习。
