# HTTP 请求与响应

HTTP 是客户端（浏览器、App、前端）与服务器之间通信的协议。客户端发送**请求对象（Request）**，服务器处理后返回**响应对象（Response）**。

## 1. 请求的组成

一次 HTTP 请求由**请求行、请求头、请求体**组成。

```http
POST /api/users?source=web HTTP/1.1
Host: example.com
Content-Type: application/json
Authorization: Bearer token

{
  "name": "张三",
  "age": 20
}
```

| 部分 | 示例 | 作用 |
| --- | --- | --- |
| 请求行 | `POST /api/users?source=web HTTP/1.1` | 请求方式、访问路径（可含查询参数）、HTTP 版本 |
| 请求头 | `Content-Type: application/json` | 描述请求元信息，如数据格式、认证信息、客户端信息 |
| 请求体 | `{"name":"张三"}` | 要提交的业务数据；常见于 `POST`、`PUT`、`PATCH` 请求 |

常见请求方式：`GET` 查询、`POST` 新增、`PUT/PATCH` 修改、`DELETE` 删除。

## 2. 响应的组成

服务器返回的响应由**状态行、响应头、响应体**组成。

```http
HTTP/1.1 201 Created
Content-Type: application/json;charset=UTF-8

{
  "id": 101,
  "name": "张三"
}
```

| 部分 | 示例 | 作用 |
| --- | --- | --- |
| 状态行 | `HTTP/1.1 201 Created` | HTTP 版本、状态码、状态描述 |
| 响应头 | `Content-Type: application/json` | 描述响应数据格式、缓存策略等元信息 |
| 响应体 | JSON、HTML、文件等 | 服务器实际返回给客户端的数据 |

### 常用响应状态码

| 范围 | 含义 | 常见状态码 |
| --- | --- | --- |
| `2xx` | 请求成功 | `200 OK`、`201 Created`、`204 No Content` |
| `4xx` | 客户端请求有问题 | `400 Bad Request`、`401 Unauthorized`、`403 Forbidden`、`404 Not Found` |
| `5xx` | 服务器处理出错 | `500 Internal Server Error` |

## 3. 在 Spring Web 中的简单映射

`@RestController` 接收 HTTP 请求；`@RequestBody` 将 JSON 请求体转换为 Java 对象；`ResponseEntity` 可以同时指定响应体、响应头和状态码。

```java
@RestController
@RequestMapping("/users")
public class UserController {

    @PostMapping
    public ResponseEntity<User> create(@RequestBody User user) {
        // 调用业务层保存用户，此处仅演示响应
        return ResponseEntity.status(HttpStatus.CREATED).body(user);
    }
}
```

> 记忆：请求看“行、头、体”；响应看“状态码、头、体”。
