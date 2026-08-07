# 第一章：面向对象进阶

## 3. `static` 的注意事项

学习静态成员时，记住下面三条规则：

1. 静态方法只能**直接访问**静态变量和静态方法。
2. 非静态方法可以直接访问静态变量、静态方法、非静态成员变量和非静态成员方法。
3. 静态方法中没有 `this` 关键字。

### 3.1 静态方法只能直接访问静态成员

静态方法属于类，调用时不一定存在对象；而非静态成员属于某个具体对象。没有对象时，Java 无法判断应当访问哪一份非静态成员。

```java
public class Demo {
    static int staticValue = 10;
    int instanceValue = 20;

    public static void staticMethod() {
        System.out.println(staticValue); // 正确：访问静态变量
        staticOtherMethod();              // 正确：调用静态方法

        // System.out.println(instanceValue); // 错误：不能直接访问实例变量
        // instanceMethod();                  // 错误：不能直接调用实例方法
    }

    public static void staticOtherMethod() {
        System.out.println("静态方法");
    }

    public void instanceMethod() {
        System.out.println("实例方法");
    }
}
```

这里的重点是“**直接访问**”。静态方法可以通过一个明确的对象去访问该对象的实例成员：

```java
public static void printInstanceValue(Demo demo) {
    System.out.println(demo.instanceValue); // 正确：通过对象访问实例变量
    demo.instanceMethod();                  // 正确：通过对象调用实例方法
}
```

### 3.2 非静态方法可以访问所有成员

非静态方法属于对象。执行非静态方法时，当前对象已经存在，因此既能访问对象自己的实例成员，也能访问类的静态成员。

```java
public class Demo {
    static int staticValue = 10;
    int instanceValue = 20;

    public static void staticMethod() {
        System.out.println("静态方法");
    }

    public void instanceMethod() {
        System.out.println(staticValue); // 正确：访问静态变量
        System.out.println(instanceValue); // 正确：访问实例变量
        staticMethod(); // 正确：调用静态方法
        otherInstanceMethod(); // 正确：调用实例方法
    }

    public void otherInstanceMethod() {
        System.out.println("另一个实例方法");
    }
}
```

| 方法类型 | 直接访问静态变量/静态方法 | 直接访问实例变量/实例方法 |
| --- | --- | --- |
| 静态方法 | 可以 | 不可以 |
| 非静态方法 | 可以 | 可以 |

### 3.3 静态方法中没有 `this`

`this` 表示“当前对象”。非静态方法由对象调用，所以可以使用 `this`；静态方法属于类，可能在一个对象都没有创建时就被调用，因此没有“当前对象”，不能使用 `this`。

```java
public class Demo {
    int instanceValue = 20;

    public void instanceMethod() {
        System.out.println(this.instanceValue); // 正确：this 代表当前 Demo 对象
    }

    public static void staticMethod() {
        // System.out.println(this.instanceValue); // 错误：静态方法中不能使用 this
    }
}
```

### 3.4 结合工具类理解

工具类中的方法通常写成静态方法，是因为它们通常只依赖传入的参数，不依赖某个工具对象自身的数据。

```java
public final class NumberUtils {
    private NumberUtils() {
    }

    public static int getMax(int a, int b) {
        return a > b ? a : b;
    }
}
```

调用时无需创建 `NumberUtils` 对象：

```java
int max = NumberUtils.getMax(10, 20);
System.out.println(max); // 20
```

因为 `getMax` 不需要对象状态，所以适合定义为静态方法；也正因它是静态方法，方法内部不能直接使用工具类的非静态成员。

### 3.5 易错示例

下面的代码为什么会报错？

```java
public class Student {
    private String name;

    public static void printName() {
        // System.out.println(name); // 编译错误
    }
}
```

`name` 属于某一个 `Student` 对象，但 `printName()` 属于 `Student` 类。调用 `Student.printName()` 时，可能根本没有创建学生对象，也就不知道要打印哪个学生的姓名。

可根据实际需求改为下面两种方式之一：

```java
// 方式一：这是对象自己的行为，改为非静态方法
public void printName() {
    System.out.println(name);
}
```

```java
// 方式二：静态方法接收一个明确的对象
public static void printName(Student student) {
    System.out.println(student.name);
}
```

### 3.6 小练习

判断下面四处代码哪些可以通过编译：

```java
public class Test {
    static int a = 10;
    int b = 20;

    public static void method1() {
        System.out.println(a); // ①
        // System.out.println(b); // ②
    }

    public void method2() {
        System.out.println(a); // ③
        System.out.println(b); // ④
    }
}
```

<details>
<summary>查看答案</summary>

①、③、④可以通过编译；②不能通过编译。

`method1()` 是静态方法，只能直接访问静态变量 `a`；`method2()` 是非静态方法，可以访问静态变量 `a` 和实例变量 `b`。

</details>

### 3.7 本节总结

> 静态方法中，只能直接访问静态成员；非静态方法可以访问静态成员和非静态成员；静态方法没有 `this`。理解关键在于：静态方法属于类，非静态成员属于对象。
