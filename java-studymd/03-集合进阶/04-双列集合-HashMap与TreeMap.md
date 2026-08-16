# 第三章：集合进阶

## 4. 双列集合 Map 速记

> 本节先掌握常用 API 和选型，扩容、红黑树转换等源码后续再学。

### Map 的特点

`Map<K, V>` 用键值对保存数据：键不能重复，值可以重复；重复添加同一个键会覆盖旧值。

**使用场景：**需要通过唯一标识快速找到数据，例如“学号 → 学生”“商品名 → 价格”。

```java
Map<String, Integer> prices = new HashMap<>();
prices.put("苹果", 6);
prices.put("香蕉", 4);
prices.put("苹果", 7);               // 覆盖旧值
System.out.println(prices.get("苹果")); // 7
```

### 常用 API

| 方法 | 作用 |
| --- | --- |
| `put(k, v)` | 添加或修改 |
| `get(k)` | 根据键查询值 |
| `remove(k)` | 根据键删除 |
| `containsKey(k)` | 判断键是否存在 |
| `size()` / `clear()` | 获取数量 / 清空 |

### 三种遍历方式

```java
// 1. 键找值
for (String key : prices.keySet()) {
    System.out.println(key + "=" + prices.get(key));
}

// 2. 键值对（常用）
for (Map.Entry<String, Integer> entry : prices.entrySet()) {
    System.out.println(entry.getKey() + "=" + entry.getValue());
}

// 3. Lambda
prices.forEach((key, value) -> System.out.println(key + "=" + value));
```

### HashMap、LinkedHashMap、TreeMap

| 集合 | 特点 | 使用场景 |
| --- | --- | --- |
| `HashMap` | 无序，查询快 | 不关心顺序，通常优先使用 |
| `LinkedHashMap` | 保持添加顺序 | 需要按录入顺序展示 |
| `TreeMap` | 按键排序 | 排行榜、编号排序、范围统计 |

#### HashMap：统计字符次数

```java
Map<Character, Integer> count = new HashMap<>();
for (char c : "aab".toCharArray()) {
    count.put(c, count.getOrDefault(c, 0) + 1);
}
System.out.println(count); // a=2, b=1（顺序不保证）
```

自定义对象作为键时，应重写 `equals()` 和 `hashCode()`。

#### LinkedHashMap：保留录入顺序

```java
Map<Integer, String> users = new LinkedHashMap<>();
users.put(2, "李四");
users.put(1, "张三");
System.out.println(users); // {2=李四, 1=张三}
```

#### TreeMap：按学号排序

```java
Map<Integer, String> students = new TreeMap<>();
students.put(1003, "王五");
students.put(1001, "张三");
students.put(1002, "李四");
System.out.println(students); // 按键升序
```

自定义键的排序方式与 `TreeSet` 相同：实现 `Comparable`，或传入 `Comparator`。

### 补充：可变参数与 Collections

可变参数适合参数数量不固定的工具方法；一个方法最多有一个，且必须放在参数列表最后。

```java
static int sum(int... nums) {
    int result = 0;
    for (int n : nums) result += n;
    return result;
}
```

`Collections` 是集合工具类，常用于排序、打乱和查找。

```java
List<Integer> list = new ArrayList<>(List.of(3, 1, 2));
Collections.sort(list);    // [1, 2, 3]
Collections.shuffle(list); // 随机打乱
```

> 暂记：`HashMap` 底层涉及哈希表、数组、链表和红黑树；先会正确使用，源码和扩容机制后续专题学习。
