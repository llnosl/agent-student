# 第三章：集合进阶

## 4. 双列集合：HashMap 与 TreeMap

### Map 的特点

`Map<K, V>` 是双列集合，一次存储一对键值（key-value）数据。

- 键（`K`）不能重复；重复添加同一个键时，后面的值会覆盖前面的值。
- 值（`V`）可以重复。
- 常用于“通过键快速查找值”的场景，例如：商品名 → 价格、学号 → 学生信息。

### HashMap 与 TreeMap 的区别

| 对比项 | `HashMap` | `TreeMap` |
| --- | --- | --- |
| 键的顺序 | 不保证顺序 | 按键的自然顺序或比较器规则排序 |
| 键是否重复 | 不重复 | 不重复 |
| 常见用途 | 快速按键查询，不关心顺序 | 需要按键排序后再遍历 |
| 键的要求 | 自定义键应正确重写 `hashCode()`、`equals()` | 键应实现 `Comparable`，或提供 `Comparator` |
| `null` 键 | 允许一个 | 自然排序时不允许 |

### HashMap 示例：查询商品价格

```java
Map<String, Integer> prices = new HashMap<>();
prices.put("脉动", 5);
prices.put("康帅博", 3);
prices.put("粤利粤", 10);

System.out.println(prices.get("脉动")); // 5

prices.put("脉动", 6);
System.out.println(prices.get("脉动")); // 6，重复键会覆盖旧值
```

### TreeMap 示例：按学号排序

```java
Map<Integer, String> students = new TreeMap<>();
students.put(1003, "张三");
students.put(1001, "李四");
students.put(1002, "王五");

for (Integer id : students.keySet()) {
    System.out.println(id + "=" + students.get(id));
}
```

输出按学号升序排列：

```text
1001=李四
1002=王五
1003=张三
```

### 常用方法

| 方法 | 作用 |
| --- | --- |
| `put(key, value)` | 添加或修改键值对 |
| `get(key)` | 根据键获取值 |
| `remove(key)` | 根据键删除键值对 |
| `containsKey(key)` | 判断是否包含某个键 |
| `keySet()` | 获取所有键，用于遍历 |
| `entrySet()` | 获取所有键值对，用于同时遍历键和值 |
