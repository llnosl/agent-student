# 第六章：数据库 MySQL

## 3. JDBC 入门

### JDBC 是什么

JDBC（Java Database Connectivity）是 Java 操作关系型数据库的一套标准 API。

数据库厂商实现 JDBC 接口并提供驱动 jar；Java 程序通过统一的 JDBC API 操作 MySQL、Oracle 等不同数据库。

**使用场景：**Java 程序把注册用户写入 MySQL，或根据用户编号查询信息。

### 基本步骤

1. 引入 MySQL 驱动。
2. 获取数据库连接 `Connection`。
3. 创建 `PreparedStatement`。
4. 执行 SQL。
5. 处理结果并关闭资源。

### Maven 驱动依赖

```xml
<dependency>
    <groupId>com.mysql</groupId>
    <artifactId>mysql-connector-j</artifactId>
    <version>8.4.0</version>
</dependency>
```

### 查询案例

```java
String url = "jdbc:mysql://localhost:3306/study";
String sql = "SELECT name FROM student WHERE id = ?";

try (Connection conn = DriverManager.getConnection(url, "root", "密码");
     PreparedStatement ps = conn.prepareStatement(sql)) {

    ps.setInt(1, 1);
    try (ResultSet rs = ps.executeQuery()) {
        if (rs.next()) {
            System.out.println(rs.getString("name"));
        }
    }
}
```

`?` 是参数占位符，使用 `PreparedStatement` 设置参数比拼接 SQL 更安全，也能避免多数 SQL 注入问题。

**使用场景：**根据用户输入的学号安全查询学生姓名。

### 常用对象

| 对象 | 作用 |
| --- | --- |
| `DriverManager` | 获取数据库连接 |
| `Connection` | 表示一次数据库连接 |
| `PreparedStatement` | 预编译并执行带参数的 SQL |
| `ResultSet` | 保存查询结果 |

> 暂记：当前掌握 JDBC 的作用和基本流程；事务、连接池与 Spring JDBC 后续学习。
