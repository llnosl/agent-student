# 第六章：数据库 MySQL

## 5. MyBatis 入门

MyBatis 是 Java 的持久层框架：开发者编写 SQL，MyBatis 负责执行 SQL、绑定参数，并将查询结果映射为 Java 对象。

本例实现：查询 `user` 表中的所有用户。

## 1. 准备数据库与实体类

```sql
CREATE TABLE user (
    id INT PRIMARY KEY AUTO_INCREMENT,
    username VARCHAR(30) NOT NULL,
    password VARCHAR(100) NOT NULL
);

INSERT INTO user(username, password) VALUES ('zhangsan', '123456');
```

```java
public class User {
    private Integer id;
    private String username;
    private String password;

    // 省略 getter、setter；也可以使用 Lombok 的 @Data
}
```

字段名与 Java 属性名一致时，MyBatis 可以自动完成 `id → id`、`username → username` 的映射。

## 2. 引入依赖

在 Spring Boot 项目的 `pom.xml` 中加入 MyBatis Starter 与 MySQL 驱动。版本通常由 Spring Boot 的依赖管理统一控制。

```xml
<dependency>
    <groupId>org.mybatis.spring.boot</groupId>
    <artifactId>mybatis-spring-boot-starter</artifactId>
</dependency>

<dependency>
    <groupId>com.mysql</groupId>
    <artifactId>mysql-connector-j</artifactId>
    <scope>runtime</scope>
</dependency>
```

## 3. 配置数据源

在 `src/main/resources/application.properties` 中配置数据库连接信息：

```properties
spring.datasource.url=jdbc:mysql://localhost:3306/study?useUnicode=true&characterEncoding=utf8&serverTimezone=Asia/Shanghai
spring.datasource.username=root
spring.datasource.password=你的数据库密码
spring.datasource.driver-class-name=com.mysql.cj.jdbc.Driver
```

实际项目不要把真实密码提交到 Git；可改用环境变量或本地未提交的配置文件。

## 4. 定义 Mapper 并编写 SQL

Mapper 是数据访问接口。`@Mapper` 让 Spring/MyBatis 识别它；`@Select` 中写查询 SQL。

```java
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Select;

@Mapper
public interface UserMapper {

    @Select("SELECT id, username, password FROM user")
    List<User> findAll();
}
```

启动类上也可以使用 `@MapperScan("com.example.mapper")` 批量扫描 Mapper，此时接口上可省略 `@Mapper`。

## 5. 在 Spring Boot 测试中调用

`@SpringBootTest` 会启动 Spring Boot 测试环境，Mapper 会作为 Bean 注入。

```java
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;

@SpringBootTest
class UserMapperTest {

    @Autowired
    private UserMapper userMapper;

    @Test
    void findAll() {
        List<User> users = userMapper.findAll();
        users.forEach(System.out::println);
    }
}
```

测试类应与启动类处于同一个包，或放在启动类所在包的子包中，确保 Spring Boot 能找到启动配置并扫描到 Mapper。

## 6. 带参数查询：始终使用 `#{}`

```java
@Select("SELECT id, username, password FROM user WHERE id = #{id}")
User findById(Integer id);
```

- `#{id}`：预编译参数占位符，参数会作为数据绑定，推荐使用。
- `${id}`：直接进行字符串替换，存在 SQL 注入风险；除经过严格白名单校验的 SQL 结构外，不要用于外部输入。

> 最小流程：建表和实体类 → 配置数据源 → 定义 `@Mapper` 接口并写 SQL → 注入 Mapper 调用。MyBatis 负责 JDBC 的大量重复工作，但 SQL 的正确性、索引设计和参数安全仍需要开发者负责。
