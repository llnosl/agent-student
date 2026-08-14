# IoC 与 DI

## 1. 核心概念

- **Bean**：被 Spring IoC 容器创建和管理的对象。
- **IoC（Inversion of Control，控制反转）**：对象创建与管理的控制权，从程序代码转交给 Spring 容器。
- **DI（Dependency Injection，依赖注入）**：容器在创建 Bean 时，将它依赖的 Bean 自动提供给它。

二者关系：**IoC 是思想和机制，DI 是 IoC 的具体实现方式。**

```text
以前：业务代码 new 对象，并自行组装依赖
现在：Spring 容器创建 Bean，并将依赖注入 Bean
```

例如 Controller 依赖 Service，Service 又依赖 Dao。容器会先准备所需 Bean，再完成逐层装配；开发者不需要为每一层手动 `new`。

## 2. 声明 Bean：交给容器管理

在类上使用以下组件注解，Spring 扫描到后会将对象注册到 IoC 容器：

| 注解 | 适用位置 | 说明 |
| --- | --- | --- |
| `@Component` | 通用组件 | 声明 Bean 的基础注解 |
| `@Controller` | 控制层 | MVC 控制器；返回 JSON 的控制器通常使用 `@RestController` |
| `@Service` | 业务层 | 标识业务服务 Bean |
| `@Repository` | 数据访问层 | 标识持久化/数据访问 Bean |

`@Controller`、`@Service`、`@Repository` 都是 `@Component` 的语义化派生注解。它们的注册能力相同，但能清楚表达分层职责。

```java
@Repository
public class UserDaoImpl implements UserDao { }

@Service
public class UserServiceImpl implements UserService { }

@RestController
public class UserController { }
```

### Bean 名称与组件扫描

- 默认 Bean 名称为**类名首字母小写**，如 `UserServiceImpl` 对应 `userServiceImpl`。
- 可用 `value` 明确命名：`@Service("fastUserService")`。
- Spring Boot 启动类默认扫描其所在包及其子包；Bean 放在扫描范围外时，需要调整包结构或使用 `@ComponentScan`。

## 3. 依赖注入（DI）的常见方式

### 方式一：构造器注入（推荐）

依赖在对象创建时就确定，可使用 `final`，也更便于单元测试。只有一个构造器时，现代 Spring 可以省略 `@Autowired`。

```java
@RestController
public class UserController {
    private final UserService userService;

    public UserController(UserService userService) {
        this.userService = userService;
    }
}
```

### 方式二：字段注入

```java
@RestController
public class UserController {
    @Autowired
    private UserService userService;
}
```

写法短，但依赖不够显式，也无法声明为 `final`；学习阶段常见，实际项目更推荐构造器注入。

### 方式三：Setter 注入

适合可选依赖或需要在创建后再替换依赖的场景。

```java
@Autowired
public void setUserService(UserService userService) {
    this.userService = userService;
}
```

## 4. 多层依赖如何由容器组装

```java
@Repository
class UserDaoImpl implements UserDao { }

@Service
class UserServiceImpl implements UserService {
    private final UserDao userDao;

    UserServiceImpl(UserDao userDao) {
        this.userDao = userDao;
    }
}

@RestController
class UserController {
    private final UserService userService;

    UserController(UserService userService) {
        this.userService = userService;
    }
}
```

容器启动后，会创建并管理 `UserDaoImpl`、`UserServiceImpl`、`UserController`，然后根据构造器参数按类型匹配并完成注入。Controller 只依赖 `UserService` 接口，Service 只依赖 `UserDao` 接口，具体实现可替换。

## 5. `@Autowired` 的匹配与多个 Bean 的处理

`@Autowired` 默认**按类型**注入。如果同一类型有多个 Bean，Spring 无法判断选哪一个，会报“需要单个 Bean，但找到多个”的错误。

解决方式：

| 方案 | 用法 | 适合场景 |
| --- | --- | --- |
| `@Primary` | 在首选实现类上标记 | 大多数场景固定优先使用一个实现 |
| `@Qualifier` | 与 `@Autowired` 配合指定 Bean 名称 | 注入点需要明确选择某一实现 |
| `@Resource` | 按名称注入（可用 `name` 指定） | 希望直接根据 Bean 名精确匹配 |

```java
@Primary
@Service
public class DefaultUserService implements UserService { }

@Service("fastUserService")
public class FastUserService implements UserService { }
```

```java
@Autowired
@Qualifier("fastUserService")
private UserService userService;

@Resource(name = "fastUserService")
private UserService anotherUserService;
```

## 6. `@Autowired` 与 `@Resource` 的区别

| 注解 | 来源 | 默认匹配规则 |
| --- | --- | --- |
| `@Autowired` | Spring Framework | 按类型匹配 |
| `@Resource` | JSR-250 / Jakarta 注解 | 优先按名称匹配，名称不匹配时再按类型尝试 |

> 实战建议：优先使用构造器注入；出现多个同类型 Bean 时，用 `@Primary` 设置默认实现，或在特定注入点用 `@Qualifier` / `@Resource(name = "...")` 明确选择。
