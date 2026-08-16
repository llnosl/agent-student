# 第四章：Maven 核心

## 1. Maven 介绍

### Maven 是什么

Maven 是 Java 项目的构建和依赖管理工具，通过 `pom.xml` 描述项目。

**使用场景：**统一管理第三方 jar，并自动完成编译、测试和打包。

**案例：**项目需要 JUnit 时，只需在 `pom.xml` 声明依赖，无须手动复制 jar。

### POM

POM（项目对象模型）就是 `pom.xml` 中的项目配置，包含坐标、依赖、插件和构建方式。

```xml
<groupId>com.example</groupId>
<artifactId>demo</artifactId>
<version>1.0-SNAPSHOT</version>
```

### Maven 坐标

坐标是项目或 jar 的唯一标识：

- `groupId`：组织名，通常为域名反写。
- `artifactId`：项目或模块名。
- `version`：版本号；开发版常用 `SNAPSHOT`，稳定发布版常用 `RELEASE` 或明确版本号。

**使用场景：**精确引入某个版本的第三方库。

### Maven 仓库

仓库用于保存和管理 jar。查找顺序通常是：**本地仓库 → 私服 → 中央仓库**。

- 本地仓库：当前电脑缓存的依赖。
- 私服：公司内部共享依赖。
- 中央仓库：Maven 官方公共仓库。

**案例：**首次构建从远程下载 JUnit；以后优先从本地仓库读取。

### 核心组成

- POM：描述项目。
- 依赖管理：下载和管理 jar。
- 生命周期：规定构建阶段。
- 插件：真正执行编译、测试和打包等任务。
