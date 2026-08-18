# 第六章：数据库 MySQL

## 4. 预编译 SQL 与非预编译 SQL

## 核心概念

- **非预编译 SQL**：将用户输入直接拼接成完整 SQL 字符串，再交给数据库执行；JDBC 中常见于 `Statement`。
- **预编译 SQL**：先将 SQL 模板发送给数据库，使用 `?` 留出**值参数**的位置，再由 `PreparedStatement` 绑定实际值并执行。

```text
SQL 模板：SELECT * FROM user WHERE username = ? AND password = ?
参数值：  ["zhangsan", "123456"]
```

## 对比

| 维度 | 非预编译：字符串拼接 | 预编译：`PreparedStatement` |
| --- | --- | --- |
| 写法 | 将参数拼进 SQL 文本 | SQL 与参数值分开传递 |
| 安全性 | 容易产生 SQL 注入 | 参数作为数据处理，能防御绝大多数注入 |
| 性能 | 每条不同文本通常都需重新解析、优化 | 重复执行同一模板时可复用解析/执行计划；实际收益取决于 JDBC 驱动与数据库配置 |
| 可读性 | 拼接、引号和转义容易出错 | `?` 与 `setXxx()` 的职责清晰 |
| 适合场景 | 完全固定、无外部输入的简单 SQL | 绝大多数包含变量或用户输入的业务 SQL（推荐） |

## 1. 非预编译 SQL：风险示例

以下代码把输入当成 SQL 语句的一部分：

```java
String username = request.getParameter("username");
String password = request.getParameter("password");

String sql = "SELECT * FROM user WHERE username = '" + username
        + "' AND password = '" + password + "'";

Statement statement = connection.createStatement();
ResultSet rs = statement.executeQuery(sql);
```

若攻击者构造输入，使条件恒为真或改变原有 SQL 逻辑，就可能绕过登录校验。这种“通过输入篡改预期 SQL 语义”的攻击称为 **SQL 注入**。

**缺点：**不安全、转义繁琐；同一业务反复执行但参数不同时，SQL 文本也会不断变化。

**优点：**对于完全写死且不含任何外部输入的 SQL，写法直观；但项目中仍建议统一使用预编译方式。

## 2. 预编译 SQL：推荐写法

```java
String sql = "SELECT * FROM user WHERE username = ? AND password = ?";

try (PreparedStatement ps = connection.prepareStatement(sql)) {
    ps.setString(1, username); // 参数下标从 1 开始
    ps.setString(2, password);

    try (ResultSet rs = ps.executeQuery()) {
        while (rs.next()) {
            System.out.println(rs.getString("username"));
        }
    }
}
```

`username` 和 `password` 不会被当作 SQL 关键字或条件解析，而是作为普通数据传递。因此即使参数中包含引号、`OR` 等字符，也不会改变 SQL 模板本身的结构。

### 优点一：更安全

预编译 SQL 将**语句结构**和**参数数据**分离，参数绑定由驱动完成，避免手动拼接时把外部输入解释为 SQL 代码。

> 注意：预编译是防注入的重要手段，但仍应进行业务校验、权限校验，并使用最小权限的数据库账号。

### 优点二：重复执行时可能更高效

例如连续删除不同用户：

```sql
DELETE FROM user WHERE id = ?
```

只需更换参数 `1`、`2`、`3`。对于同一 SQL 模板被多次执行的场景，数据库可复用已完成的解析、优化或预处理结果，减少重复工作。

> 性能并非绝对：是否真正使用服务端预编译、是否缓存执行计划，会受 MySQL 与 JDBC 驱动配置影响。安全性才是业务代码优先选用 `PreparedStatement` 的首要原因。

## 3. 一个使用案例：按 ID 删除多名用户

```java
String sql = "DELETE FROM user WHERE id = ?";

try (PreparedStatement ps = connection.prepareStatement(sql)) {
    for (int id : List.of(1, 2, 3)) {
        ps.setInt(1, id);
        ps.addBatch();
    }
    ps.executeBatch();
}
```

同一个 SQL 模板只写一次，循环中只绑定不同的 `id`。这既避免拼接错误，也便于批量执行。

## 4. `?` 不能替代 SQL 结构

占位符只能代表**值**，不能直接替代表名、列名、关键字或排序方向：

```java
// 错误：? 不能表示表名
String sql = "SELECT * FROM ? WHERE id = ?";
```

如果确实需要动态排序字段或表名，必须从固定的候选项中进行**白名单选择**，再拼接受控内容；绝不能直接拼接用户原始输入。

```java
Set<String> allowedColumns = Set.of("id", "username", "created_at");
String orderBy = allowedColumns.contains(inputColumn) ? inputColumn : "id";
String sql = "SELECT * FROM user ORDER BY " + orderBy + " DESC";
```

> 结论：业务 SQL 优先使用 `PreparedStatement`；动态 SQL 结构使用白名单，动态值始终使用 `?` 绑定。
