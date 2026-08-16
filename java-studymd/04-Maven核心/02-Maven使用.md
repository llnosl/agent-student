# 第四章：Maven 核心

## 2. Maven 使用

### 标准目录

```text
项目目录/
├─ pom.xml
└─ src/
   ├─ main/java       # 业务代码
   ├─ main/resources  # 配置文件
   └─ test/java       # 测试代码
```

**使用场景：**所有项目采用统一结构，Maven 和 IDE 能自动识别源码与测试。

### 配置依赖

依赖统一写在 `<dependencies>` 中。

```xml
<dependencies>
    <dependency>
        <groupId>org.junit.jupiter</groupId>
        <artifactId>junit-jupiter</artifactId>
        <version>5.10.2</version>
        <scope>test</scope>
    </dependency>
</dependencies>
```

**使用场景：**项目需要测试框架、数据库驱动等第三方功能。

修改依赖后，要在 IDE 中重新加载 Maven 项目；本地没有该依赖时需要联网下载。

### 排除传递依赖

某个依赖自动带入了不需要或冲突的 jar，可以使用 `<exclusions>` 排除。

```xml
<exclusions>
    <exclusion>
        <groupId>被排除依赖的groupId</groupId>
        <artifactId>被排除依赖的artifactId</artifactId>
    </exclusion>
</exclusions>
```

**案例：**框架传入旧版日志组件时，先排除旧版，再显式引入需要的版本。

### 常用命令与生命周期

生命周期中的后续阶段会先执行前面的阶段。

| 命令 | 作用 | 使用场景 |
| --- | --- | --- |
| `mvn clean` | 删除 `target` | 清理旧构建结果 |
| `mvn compile` | 编译主代码 | 检查代码能否编译 |
| `mvn test` | 运行测试 | 验证功能是否正确 |
| `mvn package` | 测试并打包 | 生成 jar 或 war |
| `mvn install` | 安装到本地仓库 | 供本机其他项目引用 |

**案例：**交付 jar 前运行 `mvn clean package`，得到全新的构建产物。

> 暂记：Maven 有 `clean`、`default`、`site` 三套生命周期；当前先掌握常用命令，详细阶段和插件原理后续学习。
