# 第六章：数据库 MySQL

## 6. JDBC 与 MyBatis 对比

## 1. 关系

JDBC 是 Java 访问关系型数据库的**标准 API**；MyBatis 是建立在 JDBC 之上的**持久层框架**。

```text
业务代码 → MyBatis（Mapper、参数绑定、结果映射） → JDBC → 数据库驱动 → MySQL
```

MyBatis 没有取代 JDBC，而是封装了 JDBC 中重复、容易出错的操作。

## 2. 查询同一批用户：代码量对比

### JDBC

```java
String sql = "SELECT id, username, password FROM user";
List<User> users = new ArrayList<>();

try (Connection conn = DriverManager.getConnection(url, username, password);
     PreparedStatement ps = conn.prepareStatement(sql);
     ResultSet rs = ps.executeQuery()) {

    while (rs.next()) {
        User user = new User();
        user.setId(rs.getInt("id"));
        user.setUsername(rs.getString("username"));
        user.setPassword(rs.getString("password"));
        users.add(user);
    }
}
```

开发者需要自己处理：连接获取、SQL 执行、`ResultSet` 遍历、列到对象属性的映射，以及资源关闭。

### MyBatis

```java
@Mapper
public interface UserMapper {

    @Select("SELECT id, username, password FROM user")
    List<User> findAll();
}
```

MyBatis 会创建 Mapper 代理对象、执行 JDBC 操作，并将结果集自动映射为 `List<User>`。

## 3. 主要差异

| 对比项 | JDBC | MyBatis |
| --- | --- | --- |
| 定位 | Java 数据库访问标准 API | 基于 JDBC 的 SQL 映射框架 |
| 连接配置 | 常在代码中通过 `DriverManager` 获取，易出现硬编码 | Spring Boot 可在 `application.properties` 集中配置数据源 |
| 连接管理 | 需自行获取、关闭；直接频繁创建连接成本高 | 通常与数据源/连接池集成，由框架和容器统一管理 |
| SQL 执行 | 手写 `Connection`、`PreparedStatement`、`ResultSet` 流程 | 在 Mapper 注解或 XML 中声明 SQL，调用接口方法即可 |
| 结果映射 | 手动 `getString()`、`getInt()` 并组装对象 | 自动映射列与 Java 属性，也可配置复杂映射 |
| 重复代码 | 较多 | 较少，开发效率高 |
| SQL 控制力 | 完全直接控制 | 仍可手写 SQL，控制力强 |

## 4. JDBC 的特点

**优点：**

- 是底层标准，理解它能帮助理解连接、预编译、事务和结果集。
- 不依赖额外 ORM/持久层框架，简单场景可直接使用。

**不足：**

- 连接信息、资源管理、结果集映射等样板代码较多。
- 如果连接创建和关闭处理不当，容易造成资源浪费或连接泄漏。
- SQL 和 Java 映射代码分散，维护成本高。

## 5. MyBatis 的特点

**优点：**

- Mapper 接口让数据库操作更接近普通 Java 方法调用。
- 自动处理大量 JDBC 样板代码，降低结果映射的重复工作。
- 参数使用 `#{}` 时采用预编译绑定，有助于防范 SQL 注入。
- 在 Spring Boot 中可集中配置数据源，并通常使用连接池提升连接复用效率。

**注意：**

- MyBatis 不会自动写好业务 SQL；SQL 正确性、索引设计和事务边界仍需开发者负责。
- 对于字段名与属性名不一致、关联查询等情况，仍需要配置别名或 `resultMap`。

## 6. 学习与使用建议

1. 先掌握 JDBC：理解 `Connection`、`PreparedStatement`、`ResultSet` 和预编译 SQL。
2. 业务项目优先使用 Spring Boot + MyBatis：减少重复代码，便于维护。
3. 无论使用 JDBC 还是 MyBatis，动态值都使用参数绑定；MyBatis 中优先写 `#{}`，不要把用户输入拼接进 `${}`。

> 一句话：JDBC 是基础能力，MyBatis 是对 JDBC 的高效封装；MyBatis 简化流程，但不替你承担 SQL 设计责任。
