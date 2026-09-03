# JSI, HostObjects & Native Modules in React Native — Complete Study Guide

> Target: React Native 0.76+ (New Architecture / Bridgeless), Hermes engine.
> Language: C++17/20, Objective-C++, Kotlin/Java, TypeScript.
> Verified API signatures against React Native 0.86 headers.

---

## Table of Contents

**Part I — Foundations**
1. [What actually runs your JavaScript](#1-what-actually-runs-your-javascript)
2. [The old Bridge, and why it had to die](#2-the-old-bridge-and-why-it-had-to-die)
3. [What JSI actually is](#3-what-jsi-actually-is)
4. [The mental model](#4-the-mental-model)

**Part II — The JSI Type System**

5. [`jsi::Runtime`](#5-jsiruntime)
6. [`jsi::Value` — the universal box](#6-jsivalue--the-universal-box)
7. [Pointer types: String, Object, Array, Function, PropNameID…](#7-pointer-types)
8. [Value semantics, moves, and why there's no copy constructor](#8-value-semantics-moves-and-copies)
9. [Conversion cheat sheet](#9-conversion-cheat-sheet)

**Part III — HostObject & HostFunction**

10. [HostObject deep dive](#10-hostobject-deep-dive)
11. [HostFunction deep dive](#11-hostfunction-deep-dive)
12. [NativeState — the modern lightweight alternative](#12-nativestate)
13. [Memory management & garbage collection](#13-memory-management--garbage-collection)

**Part IV — Threading**

14. [The JS thread rule](#14-the-js-thread-rule)
15. [CallInvoker & RuntimeExecutor](#15-callinvoker--runtimeexecutor)
16. [Async callbacks and Promises from C++](#16-async-callbacks-and-promises-from-c)

**Part V — Building a Real Module**

17. [Project layout](#17-project-layout)
18. [The C++ core (shared)](#18-the-c-core-shared)
19. [iOS: wiring it up](#19-ios-wiring-it-up)
20. [Android: wiring it up](#20-android-wiring-it-up)
21. [The TypeScript side](#21-the-typescript-side)

**Part VI — Advanced**

22. [Zero-copy binary data with ArrayBuffer & MutableBuffer](#22-zero-copy-binary-data)
23. [Installing globals & runtime-agnostic code](#23-installing-globals--runtime-agnostic-code)
24. [Secondary runtimes: Worklets & Reanimated](#24-secondary-runtimes-worklets)
25. [Synchronous native calls & when they bite](#25-synchronous-calls)

**Part VII — Ecosystem & Practice**

26. [JSI vs TurboModules vs Nitro Modules](#26-jsi-vs-turbomodules-vs-nitro)
27. [Debugging & common crashes](#27-debugging--common-crashes)
28. [Performance: what's actually fast](#28-performance)
29. [Complete worked example: a native KV store](#29-complete-worked-example)
30. [Cheat sheets & checklists](#30-cheat-sheets--checklists)
31. [Further reading](#31-further-reading)

---
---

# PART I — FOUNDATIONS

## 1. What actually runs your JavaScript

Your React Native app has **two worlds** running in the same process:

| | JavaScript world | Native world |
|---|---|---|
| Language | JS / TS | Obj-C / Swift, Kotlin / Java, C++ |
| Runs on | JS thread | Main (UI) thread + background threads |
| Executes in | A JS engine (Hermes, JSC, V8) | The OS runtime |
| Owns | Your React components, business logic | Views, camera, filesystem, sensors |

A **JS engine** is a C++ program that parses, compiles and executes JavaScript. React Native supports:

- **Hermes** — Meta's engine, built for RN. Ahead-of-time compiles to bytecode, small heap, fast startup. Default since RN 0.70.
- **JavaScriptCore (JSC)** — Apple's engine, the old default on iOS.
- **V8** — via `react-native-v8`, community.

All three are C++ codebases with wildly different internal APIs. `JSValueRef` in JSC has nothing to do with `hermes::vm::HermesValue`. That difference is the reason JSI exists.

**Key insight:** JavaScript values live inside the engine's heap. Native objects live in the app's heap. Nothing in JS can "point at" a C++ object without the engine cooperating. JSI is how the engine cooperates.

---

## 2. The old Bridge, and why it had to die

### 2.1 How the Bridge worked

Pre-New-Architecture, JS and native never touched each other. They exchanged **serialized messages over an asynchronous queue** called the Bridge.

```
JS thread                    Bridge                    Native thread
─────────                    ──────                    ─────────────
NativeModules.Camera
  .takePhoto(opts, cb)
       │
       ├─ serialize to JSON ──► [ [modId, methodId, args, cbId] ]
       │                              │
       │                              │  (async queue, batched every frame)
       │                              ▼
       │                        deserialize JSON
       │                              │
       │                              ▼
       │                        [RCTCamera takePhoto:...]
       │                              │
       │                        serialize result
       ◄──────────────────────── [ [cbId, result] ]
       │
   invoke cb
```

Every call was:
1. `JSON.stringify` the arguments on the JS thread,
2. push onto a message queue,
3. batched and flushed,
4. `JSON.parse` on the native side,
5. dispatch to a module by *numeric ID looked up in a registry*,
6. and the same in reverse for the result.

### 2.2 The three fatal problems

**Problem 1 — Everything is asynchronous.**
There was no way to synchronously ask native a question. `Dimensions.get('window')` had to be pre-populated at startup and cached in JS, because you literally could not ask native for the screen size and get an answer in the same tick. Anything needing a sync answer had to be hacked in as a constant exported at bridge init.

**Problem 2 — Serialization cost.**
Every argument and every return value round-trips through JSON. Passing a 5MB image buffer meant base64-encoding it into a string, shipping the string, and decoding it. Passing 60 layout updates per second for a gesture meant 60 JSON serializations per second — the classic "gesture feels laggy" bug.

**Problem 3 — The bridge is a bottleneck and it's blind.**
One queue, shared by everything: view updates, network callbacks, timers, module calls. Congestion in one area stalls everything. And because it's all stringly-typed JSON, there is **no type safety** — a JS/native signature mismatch is a runtime crash, not a compile error.

Plus: all modules were eagerly initialized at startup, whether you used them or not.

### 2.3 What replaced it

| Old Architecture | New Architecture |
|---|---|
| Bridge (async JSON queue) | **JSI** (direct C++ ↔ JS) |
| NativeModules | **TurboModules** (lazy, typed, JSI-backed) |
| Paper renderer (async view ops) | **Fabric** (C++ shadow tree, sync layout) |
| Handwritten `RCT_EXPORT_METHOD` | **Codegen** (types generated from TS specs) |

JSI is the foundation layer. TurboModules and Fabric are both built *on top of* JSI.

---

## 3. What JSI actually is

**JSI = JavaScript Interface.** It is a small, engine-agnostic C++ header-only-ish API that lets C++ code:

- create, read and mutate JavaScript values,
- call JavaScript functions,
- expose C++ functions and C++ objects **directly** to JavaScript,
- evaluate JavaScript source.

It lives at `node_modules/react-native/ReactCommon/jsi/jsi/jsi.h`. It is **not** React Native specific — it's a standalone abstraction that RN happens to use. Hermes, JSC and V8 each ship a JSI *implementation*; your code compiles against the interface.

```
        ┌──────────────────────────────────┐
        │        Your C++ code             │
        │   (uses jsi::Runtime, jsi::Value)│
        └────────────────┬─────────────────┘
                         │  jsi.h  (the interface)
        ┌────────────────┴─────────────────┐
        │                                  │
   ┌────▼─────┐   ┌──────────┐   ┌─────────▼──┐
   │ Hermes   │   │   JSC    │   │    V8      │
   │ Runtime  │   │ Runtime  │   │  Runtime   │
   └──────────┘   └──────────┘   └────────────┘
```

### 3.1 What JSI unlocks

| Capability | Bridge | JSI |
|---|---|---|
| Synchronous native calls | ❌ | ✅ |
| Pass a C++ object to JS without copying | ❌ | ✅ (HostObject) |
| Pass a C++ function to JS | ❌ (only callbacks) | ✅ (HostFunction) |
| Call a JS function from C++ | Only via bridge queue | ✅ Directly |
| Share memory (no copy) | ❌ | ✅ (ArrayBuffer + MutableBuffer) |
| Lazy module init | ❌ | ✅ |
| Type safety | ❌ | ✅ (via Codegen) |

### 3.2 The core idea in one sentence

> JSI lets you take a `std::shared_ptr<MyCppClass>` and hand it to JavaScript as if it were a normal JS object — so that `obj.foo()` in JS becomes a direct C++ virtual method call, with no serialization, no queue, and no thread hop.

---

## 4. The mental model

Hold these five facts and most of JSI follows:

1. **`jsi::Runtime&` is the handle to the engine.** Almost every JSI call takes it as the first parameter. It is *not* thread-safe. It is *not* copyable. You always pass it by reference.

2. **`jsi::Value` is a tagged union.** It holds exactly one of: `undefined`, `null`, `boolean`, `number`, `string`, `symbol`, `bigint`, `object`. It is the type of every JS value crossing the boundary.

3. **JSI "pointer" types are GC handles, not raw pointers.** `jsi::Object`, `jsi::String`, `jsi::Function` etc. are handles that keep a JS value alive while they're in scope. They're scoped to the runtime that made them.

4. **A `HostObject` is a C++ object that JS sees as an object.** Property access on the JS side calls your C++ `get()` / `set()`.

5. **A `HostFunction` is a C++ lambda that JS sees as a function.** Calling it from JS is a direct call into your C++.

```
JavaScript                              C++
──────────                              ───

  const s = storage           ◄──────  Object::createFromHostObject(rt, ptr)
  s.name                      ──────►  MyHostObject::get(rt, "name")
  s.set('k','v')              ──────►  HostFunction lambda(rt, this, args, 2)
  s.count = 5                 ──────►  MyHostObject::set(rt, "count", Value(5))
  Object.keys(s)              ──────►  MyHostObject::getPropertyNames(rt)

  function onDone(x) {...}
  s.subscribe(onDone)         ──────►  args[0].asObject(rt).asFunction(rt)
                                       │ store as shared_ptr<jsi::Function>
                                       │ later, on JS thread:
  onDone(42)                  ◄──────  fn->call(rt, 42)
```

---
---

# PART II — THE JSI TYPE SYSTEM

## 5. `jsi::Runtime`

```cpp
namespace facebook::jsi {

class Runtime {
 public:
  virtual Value evaluateJavaScript(
      const std::shared_ptr<const Buffer>& buffer,
      const std::string& sourceURL) = 0;

  virtual Object global() = 0;          // the JS globalThis
  virtual std::string description() = 0; // e.g. "HermesRuntime"
  virtual bool isInspectable() = 0;
  // ... plus ~80 protected virtuals that the engine implements
};

}
```

**What you actually use it for:**

```cpp
// Get globalThis
jsi::Object global = rt.global();

// Install something on globalThis
global.setProperty(rt, "__myNativeThing", jsi::Value(42));

// Read a global
auto console = global.getPropertyAsObject(rt, "console");

// Evaluate JS from C++ (rare; useful for polyfills)
rt.evaluateJavaScript(
    std::make_shared<jsi::StringBuffer>("globalThis.x = 1;"),
    "my-polyfill.js");
```

**Critical properties:**

- ❌ Not thread-safe. One thread at a time. Always the JS thread (or a worklet thread for its own runtime).
- ❌ Not copyable, not movable. Always `jsi::Runtime&`.
- ⚠️ A `jsi::Value` created in runtime A must never be used in runtime B. Doing so is undefined behaviour, usually a hard crash.
- ⚠️ The runtime can be torn down (reload, Fast Refresh). Anything you cached must be released before that. See §27.

---

## 6. `jsi::Value` — the universal box

`Value` is how every JS value is represented in C++.

### 6.1 Construction

```cpp
jsi::Value v1;                                    // undefined
jsi::Value v2 = jsi::Value::undefined();          // undefined
jsi::Value v3 = jsi::Value::null();               // null
jsi::Value v4(true);                              // boolean
jsi::Value v5(42);                                // number (int → double)
jsi::Value v6(3.14);                              // number
jsi::Value v7(rt, jsi::String::createFromUtf8(rt, "hi"));   // string
jsi::Value v8(rt, someObject);                    // object (copies the handle)
jsi::Value v9(std::move(someObject));             // object (moves the handle)
```

> ⚠️ **Gotcha:** `jsi::Value(42)` where `42` is an `int` works. But `jsi::Value(someSizeT)` is ambiguous — `size_t` doesn't implicitly pick `double`. Cast explicitly: `jsi::Value(static_cast<double>(n))`.

> ⚠️ **Gotcha:** `jsi::Value("hello")` compiles but gives you `true` (const char* → bool!). Always use `jsi::String::createFromUtf8`.

### 6.2 Type checks

```cpp
v.isUndefined();
v.isNull();
v.isBool();
v.isNumber();
v.isString();
v.isSymbol();
v.isBigInt();
v.isObject();
```

### 6.3 Extraction — `get*` vs `as*`

Two families, and the difference matters:

```cpp
// get* — ASSERTS. Undefined behaviour / abort if the type is wrong.
bool   b = v.getBool();
double d = v.getNumber();
jsi::String s = v.getString(rt);
jsi::Object o = v.getObject(rt);

// as* — THROWS jsi::JSError if the type is wrong. Safe.
double d2 = v.asNumber();
jsi::String s2 = v.asString(rt);
jsi::Object o2 = v.asObject(rt);
```

**Rule: use `as*` on anything coming from JS** (you don't control what the caller passes). Use `get*` only after an explicit `is*` check, or on values you created yourself.

```cpp
// GOOD
if (!args[0].isNumber()) {
  throw jsi::JSError(rt, "expected a number as the first argument");
}
double n = args[0].getNumber();

// ALSO GOOD (throws a JS TypeError-ish for you)
double n = args[0].asNumber();

// BAD — crashes the app if JS passes a string
double n = args[0].getNumber();
```

### 6.4 String conversion

```cpp
jsi::Value v = ...;
std::string s = v.toString(rt).utf8(rt);   // like JS String(v)
```

---

## 7. Pointer types

All of these derive from `jsi::Pointer`. They are **GC-safe handles**: while a handle is alive, the underlying JS value won't be collected.

### 7.1 `jsi::String`

```cpp
auto s = jsi::String::createFromAscii(rt, "hello");
auto s = jsi::String::createFromUtf8(rt, std::string("héllo"));
auto s = jsi::String::createFromUtf8(rt, bytes, length);

std::string out = s.utf8(rt);
bool same = jsi::String::strictEquals(rt, a, b);
```

> Strings are **immutable** and **copied** across the boundary. `utf8()` allocates a `std::string`. Hot-loop string conversion is a real cost — see §28.

### 7.2 `jsi::PropNameID`

An interned property key. Cheaper than a String for repeated property access.

```cpp
auto id = jsi::PropNameID::forAscii(rt, "myProp");
auto id = jsi::PropNameID::forUtf8(rt, std::string("myProp"));
auto id = jsi::PropNameID::forString(rt, someJsiString);
auto id = jsi::PropNameID::forSymbol(rt, someSymbol);

std::string name = id.utf8(rt);
bool eq = jsi::PropNameID::compare(rt, a, b);
```

Used in: `HostObject::get/set`, `getPropertyNames`, `Function::createFromHostFunction`.

### 7.3 `jsi::Object`

The workhorse.

```cpp
jsi::Object obj(rt);                       // {} — a fresh empty object

// Properties
obj.setProperty(rt, "count", 42);
obj.setProperty(rt, "name", jsi::String::createFromUtf8(rt, "x"));
obj.setProperty(rt, propNameId, someValue);

jsi::Value v      = obj.getProperty(rt, "count");
jsi::Object child = obj.getPropertyAsObject(rt, "child");     // throws if not object
jsi::Function fn  = obj.getPropertyAsFunction(rt, "callback"); // throws if not function
bool has          = obj.hasProperty(rt, "count");

jsi::Array keys = obj.getPropertyNames(rt);

// Type interrogation
obj.isArray(rt);
obj.isFunction(rt);
obj.isArrayBuffer(rt);
obj.isHostObject<MyHostObject>(rt);

// Conversion
jsi::Array a  = obj.asArray(rt);
jsi::Function f = obj.asFunction(rt);

// Identity
bool same = jsi::Object::strictEquals(rt, a, b);

// Explicit copy of the handle (see §8)
jsi::Object copy = jsi::Value(rt, obj).getObject(rt);
```

### 7.4 `jsi::Array`

```cpp
jsi::Array arr(rt, 3);                   // new Array(3)
size_t n = arr.size(rt);
arr.setValueAtIndex(rt, 0, jsi::Value(1));
jsi::Value v = arr.getValueAtIndex(rt, 0);

// From a C++ vector
jsi::Array toJs(jsi::Runtime& rt, const std::vector<double>& in) {
  jsi::Array out(rt, in.size());
  for (size_t i = 0; i < in.size(); i++) {
    out.setValueAtIndex(rt, i, jsi::Value(in[i]));
  }
  return out;
}
```

### 7.5 `jsi::Function`

```cpp
// Calling a JS function from C++
jsi::Value result = fn.call(rt, arg1, arg2);
jsi::Value result = fn.call(rt, argsPtr, argCount);
jsi::Value result = fn.callWithThis(rt, thisObj, arg1);
jsi::Object inst  = fn.callAsConstructor(rt, arg1);

// Creating a C++ function that JS can call
auto f = jsi::Function::createFromHostFunction(
    rt,
    jsi::PropNameID::forAscii(rt, "add"),
    2,                                    // arity hint (fn.length in JS)
    [](jsi::Runtime& rt,
       const jsi::Value& thisVal,
       const jsi::Value* args,
       size_t count) -> jsi::Value {
      return jsi::Value(args[0].asNumber() + args[1].asNumber());
    });
```

### 7.6 `jsi::ArrayBuffer`

```cpp
// Read an ArrayBuffer JS gave you
jsi::ArrayBuffer buf = obj.getArrayBuffer(rt);
uint8_t* data = buf.data(rt);
size_t   size = buf.size(rt);

// Create one backed by your own memory — ZERO COPY (see §22)
jsi::ArrayBuffer out(rt, std::make_shared<MyMutableBuffer>(...));
```

### 7.7 `jsi::Symbol` and `jsi::BigInt`

```cpp
jsi::Symbol sym = value.asSymbol(rt);
std::string s = sym.toString(rt);

jsi::BigInt bi = jsi::BigInt::fromInt64(rt, 9007199254740993LL);
jsi::BigInt bu = jsi::BigInt::fromUint64(rt, 18446744073709551615ULL);
int64_t back = bi.asInt64(rt);       // throws if it doesn't fit
uint64_t tr  = bi.getUint64(rt);     // truncating
```

BigInt is the correct way to move 64-bit integers (file handles, native pointers, DB row ids) without the precision loss of `double`.

---

## 8. Value semantics, moves, and copies

This trips up nearly everyone coming from JS.

**JSI pointer types and `Value` have their copy constructors deleted.** They are move-only.

```cpp
jsi::Object a(rt);
jsi::Object b = a;              // ❌ COMPILE ERROR — copy ctor deleted
jsi::Object b = std::move(a);   // ✅ move — `a` is now invalid
```

Why? Because copying a GC handle requires the runtime (to register the new reference), and a C++ copy constructor doesn't have access to it.

**To copy, use the explicit two-arg constructor that takes the runtime:**

```cpp
jsi::Value copy(rt, original);              // ✅ explicit copy of a Value
jsi::Object copy = jsi::Value(rt, obj).getObject(rt);   // copy an Object
jsi::String copy = jsi::Value(rt, str).getString(rt);   // copy a String
```

**Practical consequences:**

```cpp
// ❌ Won't compile — jsi::Value in a container needs care
std::vector<jsi::Value> vals;
vals.push_back(someValue);          // ❌ copy
vals.push_back(std::move(someValue)); // ✅ move
vals.emplace_back(rt, someValue);     // ✅ explicit copy

// ❌ Won't compile — lambda capture by value copies
auto fn = [obj]() { ... };            // ❌
auto fn = [obj = std::move(obj)]() { ... };  // ✅ C++14 init-capture

// Returning is fine — guaranteed copy elision / move
jsi::Value makeThing(jsi::Runtime& rt) {
  jsi::Object o(rt);
  o.setProperty(rt, "a", 1);
  return jsi::Value(std::move(o));   // ✅
}
```

**A `Value` holding an object owns a handle.** When the `Value` is destroyed, the handle is released, and the JS object becomes collectible (if nothing else references it).

---

## 9. Conversion cheat sheet

| From C++ | To JS | Code |
|---|---|---|
| `double` | number | `jsi::Value(d)` |
| `int` | number | `jsi::Value(static_cast<double>(i))` |
| `bool` | boolean | `jsi::Value(b)` |
| `std::string` | string | `jsi::String::createFromUtf8(rt, s)` |
| `int64_t` | bigint | `jsi::BigInt::fromInt64(rt, n)` |
| `std::vector<T>` | Array | loop + `setValueAtIndex` |
| `std::map<string,T>` | Object | loop + `setProperty` |
| `std::shared_ptr<HostObject>` | object | `jsi::Object::createFromHostObject(rt, p)` |
| lambda | function | `jsi::Function::createFromHostFunction(...)` |
| `uint8_t*` + size | ArrayBuffer | `jsi::ArrayBuffer(rt, mutableBuffer)` |
| nothing | undefined | `jsi::Value::undefined()` |

| From JS | To C++ | Code |
|---|---|---|
| number | `double` | `v.asNumber()` |
| boolean | `bool` | `v.asBool()` |
| string | `std::string` | `v.asString(rt).utf8(rt)` |
| bigint | `int64_t` | `v.asBigInt(rt).asInt64(rt)` |
| array | iterate | `v.asObject(rt).asArray(rt)` |
| function | callable | `v.asObject(rt).asFunction(rt)` |
| ArrayBuffer | `uint8_t*` | `v.asObject(rt).getArrayBuffer(rt).data(rt)` |
| any | `std::string` | `v.toString(rt).utf8(rt)` |

**Reusable helpers worth writing once:**

```cpp
namespace jsiutil {

inline jsi::Value str(jsi::Runtime& rt, const std::string& s) {
  return jsi::Value(rt, jsi::String::createFromUtf8(rt, s));
}

inline std::string toStr(jsi::Runtime& rt, const jsi::Value& v) {
  return v.asString(rt).utf8(rt);
}

template <typename T>
jsi::Array toArray(jsi::Runtime& rt,
                   const std::vector<T>& in,
                   std::function<jsi::Value(jsi::Runtime&, const T&)> conv) {
  jsi::Array out(rt, in.size());
  for (size_t i = 0; i < in.size(); i++) {
    out.setValueAtIndex(rt, i, conv(rt, in[i]));
  }
  return out;
}

inline void requireArgs(jsi::Runtime& rt, size_t count, size_t expected,
                        const char* fnName) {
  if (count < expected) {
    throw jsi::JSError(rt, std::string(fnName) + " expects " +
                             std::to_string(expected) + " arguments, got " +
                             std::to_string(count));
  }
}

} // namespace jsiutil
```

---
---

# PART III — HOSTOBJECT & HOSTFUNCTION

## 10. HostObject deep dive

### 10.1 The definition (verbatim from `jsi.h`)

```cpp
class JSI_EXPORT HostObject {
 public:
  // The C++ object's dtor will be called when the GC finalizes this
  // object. (This may be as late as when the Runtime is shut down.)
  // You have no control over which thread it is called on. This will
  // be called from inside the GC, so it is unsafe to do any VM
  // operations which require a IRuntime&.
  virtual ~HostObject();

  // When JS wants a property with a given name from the HostObject,
  // it will call this method. If it throws an exception, the call
  // will throw a JS Error object. By default this returns undefined.
  virtual Value get(Runtime&, const PropNameID& name);

  // When JS wants to set a property with a given name on the HostObject,
  // it will call this method. If it throws, the call will throw a JS
  // Error object. The default implementation throws a type error,
  // mimicking a frozen object in strict mode.
  virtual void set(Runtime&, const PropNameID& name, const Value& value);

  // When JS wants a list of property names for the HostObject, it will
  // call this method. The default implementation returns an empty vector.
  virtual std::vector<PropNameID> getPropertyNames(Runtime& rt);
};
```

Read the comments above carefully — they contain the two most important rules:

1. **The destructor runs on an unspecified thread, from inside the GC.** Do not touch the runtime there. Do not do expensive work there.
2. **Throwing a C++ exception from `get`/`set` becomes a JS exception.** That's the correct way to signal errors.

### 10.2 Your first HostObject

```cpp
#include <jsi/jsi.h>

using namespace facebook;

class Counter : public jsi::HostObject {
 public:
  jsi::Value get(jsi::Runtime& rt, const jsi::PropNameID& name) override {
    auto prop = name.utf8(rt);

    if (prop == "value") {
      return jsi::Value(static_cast<double>(count_));
    }

    if (prop == "increment") {
      return jsi::Function::createFromHostFunction(
          rt,
          jsi::PropNameID::forAscii(rt, "increment"),
          0,
          [this](jsi::Runtime& rt,
                 const jsi::Value&,
                 const jsi::Value*,
                 size_t) -> jsi::Value {
            count_++;
            return jsi::Value(static_cast<double>(count_));
          });
    }

    return jsi::Value::undefined();   // JS sees `undefined`
  }

  void set(jsi::Runtime& rt,
           const jsi::PropNameID& name,
           const jsi::Value& value) override {
    auto prop = name.utf8(rt);
    if (prop == "value") {
      count_ = static_cast<int64_t>(value.asNumber());
      return;
    }
    throw jsi::JSError(rt, "Cannot set property '" + prop + "' on Counter");
  }

  std::vector<jsi::PropNameID> getPropertyNames(jsi::Runtime& rt) override {
    std::vector<jsi::PropNameID> keys;
    keys.push_back(jsi::PropNameID::forAscii(rt, "value"));
    keys.push_back(jsi::PropNameID::forAscii(rt, "increment"));
    return keys;
  }

 private:
  int64_t count_ = 0;
};
```

**Handing it to JS:**

```cpp
void install(jsi::Runtime& rt) {
  auto counter = std::make_shared<Counter>();
  rt.global().setProperty(
      rt,
      "NativeCounter",
      jsi::Object::createFromHostObject(rt, counter));
}
```

**Using it from JS:**

```js
NativeCounter.value;         // 0    → calls Counter::get(rt, "value")
NativeCounter.increment();   // 1    → calls get("increment"), then the lambda
NativeCounter.increment();   // 2
NativeCounter.value = 100;   //      → calls Counter::set(rt, "value", 100)
Object.keys(NativeCounter);  // ['value','increment'] → getPropertyNames
NativeCounter.nope;          // undefined
NativeCounter.nope = 1;      // throws: Cannot set property 'nope' on Counter
```

### 10.3 The `get()` performance trap — and how to fix it

**Every single property access calls `get()`.** This code:

```js
for (let i = 0; i < 100000; i++) {
  NativeCounter.increment();
}
```

does **100,000** `get("increment")` calls, and each one allocates a **brand new `jsi::Function` object**. That's 100k JS objects for the GC to clean up, plus 100k `PropNameID::utf8()` string allocations, plus 100k string comparisons.

**Fix 1 — cache the created functions:**

```cpp
class Counter : public jsi::HostObject {
 public:
  jsi::Value get(jsi::Runtime& rt, const jsi::PropNameID& name) override {
    auto prop = name.utf8(rt);

    auto it = cache_.find(prop);
    if (it != cache_.end()) {
      return jsi::Value(rt, *it->second);   // explicit copy of the handle
    }

    if (prop == "increment") {
      auto fn = jsi::Function::createFromHostFunction(/* ... */);
      auto stored = std::make_shared<jsi::Function>(std::move(fn));
      cache_[prop] = stored;
      return jsi::Value(rt, *stored);
    }
    return jsi::Value::undefined();
  }

 private:
  // ⚠️ These hold JS values alive. They MUST be cleared before the
  //    runtime is destroyed. See §27 on runtime teardown.
  std::unordered_map<std::string, std::shared_ptr<jsi::Function>> cache_;
};
```

**Fix 2 (better) — don't use a HostObject for methods at all.**
Build a plain `jsi::Object` once, put HostFunctions on it as real properties, and let the engine's normal property lookup (which is fast and inline-cached) do the work:

```cpp
jsi::Object makeCounterApi(jsi::Runtime& rt) {
  auto state = std::make_shared<int64_t>(0);
  jsi::Object api(rt);

  api.setProperty(rt, "increment",
      jsi::Function::createFromHostFunction(
          rt, jsi::PropNameID::forAscii(rt, "increment"), 0,
          [state](jsi::Runtime& rt, const jsi::Value&,
                  const jsi::Value*, size_t) -> jsi::Value {
            return jsi::Value(static_cast<double>(++(*state)));
          }));

  return api;
}
```

**Rule of thumb:**
- Use **HostObject** when the property set is *dynamic* (a key-value store, a JSON-like proxy, a database row) or when you need `set()` interception.
- Use a **plain Object + HostFunctions** when you have a fixed API surface (which is most modules).

**Fix 3 — avoid `name.utf8(rt)` in hot paths.** It allocates a `std::string` every call. If you must dispatch on the name, compare against pre-interned `PropNameID`s with `jsi::PropNameID::compare(rt, a, b)`, or hash once at construction.

### 10.4 Retrieving your C++ object back from JS

```cpp
// Check
if (obj.isHostObject<Counter>(rt)) { ... }

// Get (asserts — check first, or use the throwing variant via a cast)
std::shared_ptr<Counter> c = obj.getHostObject<Counter>(rt);

// Generic
std::shared_ptr<jsi::HostObject> h = obj.getHostObject(rt);
```

A common pattern — a factory function that returns HostObjects, and other functions that accept them back:

```cpp
// JS: const conn = Db.open('file.db');  Db.query(conn, 'SELECT 1');
auto query = [](jsi::Runtime& rt, const jsi::Value&,
                const jsi::Value* args, size_t count) -> jsi::Value {
  if (count < 2 || !args[0].isObject()) {
    throw jsi::JSError(rt, "query(connection, sql) — bad arguments");
  }
  auto obj = args[0].getObject(rt);
  if (!obj.isHostObject<DbConnection>(rt)) {
    throw jsi::JSError(rt, "first argument is not a DB connection");
  }
  auto conn = obj.getHostObject<DbConnection>(rt);
  auto sql  = args[1].asString(rt).utf8(rt);
  return conn->execute(rt, sql);
};
```

### 10.5 HostObject lifetime

```
JS side                          C++ side
───────                          ────────
global.Counter = <hostobject>    shared_ptr<Counter> refcount = 1 (held by JS)
  │
  │  (JS drops all references)
  ▼
unreachable
  │
  │  ... time passes ...
  ▼
GC runs, finalizes the object    shared_ptr released → refcount 0 → ~Counter()
                                 ⚠️ on an unknown thread, inside the GC
```

**You do not control when the destructor runs.** It may run:
- long after JS dropped the reference,
- never (if the runtime is force-killed),
- on the GC thread, not the JS thread.

So:

```cpp
~MyHostObject() override {
  // ✅ fine
  file_.close();
  delete[] buffer_;

  // ❌ NEVER — you don't have a valid runtime, and you're on the wrong thread
  // runtime_.global().setProperty(...);
  // callback_->call(runtime_, ...);

  // ❌ AVOID — blocking work stalls the GC
  // uploadEverythingToServerSynchronously();
}
```

If you need JS-visible cleanup, expose an explicit `.close()` / `.dispose()` method and have JS call it (`try/finally`, `useEffect` cleanup). Treat the destructor as a last-resort safety net only.

### 10.6 HostObject checklist

- [ ] `get()` returns `Value::undefined()` for unknown props (don't throw — JS probes objects constantly, e.g. `Symbol.toPrimitive`, `then`, `toJSON`).
- [ ] Handle the probe keys: if your object is ever `await`ed, JS will read `.then` on it. Returning a function there by accident makes it thenable and breaks things.
- [ ] `set()` either handles the key or throws a clear error.
- [ ] `getPropertyNames()` implemented if you want spread/`Object.keys` to work.
- [ ] Functions cached, or you moved to a plain-Object API.
- [ ] Destructor is cheap, thread-agnostic, and touches no runtime.
- [ ] No raw `jsi::Runtime*` stored as a member without an invalidation story.

---

## 11. HostFunction deep dive

### 11.1 The signature

```cpp
using HostFunctionType = std::function<Value(
    Runtime& rt,          // the runtime — always use this one, not a captured one
    const Value& thisVal, // `this` at the call site
    const Value* args,    // C array of arguments
    size_t count)>;       // how many were actually passed
```

Created with:

```cpp
static Function createFromHostFunction(
    Runtime& runtime,
    const PropNameID& name,   // the function's .name in JS
    unsigned int paramCount,  // the function's .length in JS (a hint only!)
    HostFunctionType func);
```

### 11.2 `paramCount` is a lie (a hint)

`paramCount` sets `fn.length`. It does **not** enforce anything. JS can call your 2-arg function with 0 args or 50 args. **Always check `count` yourself.**

```cpp
[](jsi::Runtime& rt, const jsi::Value&, const jsi::Value* args, size_t count)
    -> jsi::Value {
  if (count < 2) {
    throw jsi::JSError(rt, "add() requires 2 arguments");
  }
  // args[2] here would be reading out of bounds — undefined behaviour
  return jsi::Value(args[0].asNumber() + args[1].asNumber());
}
```

Reading `args[i]` for `i >= count` is an out-of-bounds read. It will not "just be undefined". It's a crash or garbage.

### 11.3 Capture rules

The lambda outlives the call. It is stored inside a JS object. Capture accordingly.

```cpp
// ❌ DANGLING — `localConfig` dies when the enclosing function returns
std::string localConfig = loadConfig();
auto fn = jsi::Function::createFromHostFunction(rt, id, 0,
    [&localConfig](...) { use(localConfig); });   // 💥

// ✅ copy by value
auto fn = ... [localConfig](...) { use(localConfig); };

// ✅ shared ownership — the usual choice
auto state = std::make_shared<MyState>();
auto fn = ... [state](...) { state->doThing(); };

// ⚠️ `this` capture — only safe if `this` is guaranteed to outlive the JS object.
//    Inside a HostObject's get(), capturing `this` is *usually* fine because the
//    function is stored on the same JS object that owns the HostObject — but if
//    JS extracts the method (`const f = obj.method`) and keeps it after the object
//    dies, you dangle. Capture a shared_ptr instead when in doubt:
auto self = shared_from_this();   // requires enable_shared_from_this
auto fn = ... [self](...) { self->doThing(); };

// ❌ NEVER capture jsi::Runtime& in a lambda that may run later on another thread.
//    Use the `rt` parameter passed to the lambda.
```

### 11.4 Throwing errors

```cpp
throw jsi::JSError(rt, "Something went wrong");     // becomes a JS Error
throw jsi::JSError(rt, jsi::Value(rt, customObj));  // throw a custom JS value
```

`jsi::JSError` is caught by the JSI layer and re-thrown into JS, so `try/catch` in JS works normally.

Other exception types:
- `jsi::JSIException` — base class.
- `jsi::JSINativeException` — a native error that isn't a JS value.

> ⚠️ Letting a raw `std::exception` (or worse, anything) escape a HostFunction is undefined behaviour in some engine configurations. Wrap risky bodies:

```cpp
try {
  return doTheWork(rt, args, count);
} catch (const jsi::JSError&) {
  throw;                                  // already a JS error, pass it through
} catch (const std::exception& e) {
  throw jsi::JSError(rt, std::string("native error: ") + e.what());
} catch (...) {
  throw jsi::JSError(rt, "unknown native error");
}
```

### 11.5 Receiving a JS function (callback) in C++

```cpp
auto subscribe = [](jsi::Runtime& rt, const jsi::Value&,
                    const jsi::Value* args, size_t count) -> jsi::Value {
  if (count < 1 || !args[0].isObject()) {
    throw jsi::JSError(rt, "subscribe(cb) requires a function");
  }
  auto obj = args[0].getObject(rt);
  if (!obj.isFunction(rt)) {
    throw jsi::JSError(rt, "subscribe(cb) requires a function");
  }

  // Take ownership so it survives past this call
  auto cb = std::make_shared<jsi::Function>(obj.asFunction(rt));

  // Later, ON THE JS THREAD ONLY:
  //   cb->call(rt, jsi::Value(42));

  return jsi::Value::undefined();
};
```

⚠️ Holding a `shared_ptr<jsi::Function>` keeps a JS value alive across the boundary. Two rules:
1. You may only `call()` it on the JS thread — see §15.
2. You must release it before the runtime is destroyed — see §27.

---

## 12. NativeState

`NativeState` is a lighter-weight alternative to `HostObject`, added to JSI more recently. It attaches C++ data to a **plain JS object** without intercepting property access.

```cpp
class JSI_EXPORT NativeState {
 public:
  virtual ~NativeState();
};
```

Usage:

```cpp
class ImageData : public jsi::NativeState {
 public:
  ImageData(int w, int h) : width(w), height(h) {}
  int width, height;
  std::vector<uint8_t> pixels;
};

// Attach
jsi::Object obj(rt);
obj.setNativeState(rt, std::make_shared<ImageData>(1920, 1080));
obj.setProperty(rt, "width", 1920);    // normal fast JS properties!

// Retrieve
if (obj.hasNativeState<ImageData>(rt)) {
  auto data = obj.getNativeState<ImageData>(rt);
  use(data->pixels);
}
```

**HostObject vs NativeState:**

| | HostObject | NativeState |
|---|---|---|
| Property reads | Go through your C++ `get()` | Normal JS property lookup (fast, inline-cached) |
| Dynamic keys | ✅ | ❌ |
| Intercept writes | ✅ `set()` | ❌ |
| Per-access cost | High | Zero |
| Object identity | The object *is* the host object | Any object can carry state |

**Use NativeState when:** you have a fixed shape and just need to hang C++ data off a JS object. This is the pattern Fabric and modern libraries increasingly prefer.

**Use HostObject when:** you genuinely need to intercept arbitrary property access.

---

## 13. Memory management & garbage collection

### 13.1 Who owns what

```
┌─────────────────────────────────────────────────────────────┐
│  JS heap (Hermes)                                           │
│                                                             │
│   {} ──── hostObjectSlot ──────┐                            │
│                                │                            │
└────────────────────────────────┼────────────────────────────┘
                                 │ shared_ptr
┌────────────────────────────────▼────────────────────────────┐
│  Native heap                                                │
│                                                             │
│   MyHostObject { cache_: shared_ptr<jsi::Function> ─────────┼──┐
│                  callback_: shared_ptr<jsi::Function> ──────┼──┤
│                }                                            │  │
└─────────────────────────────────────────────────────────────┘  │
                                                                 │
   ⚠️ Those handles point BACK into the JS heap ◄─────────────────┘
      → a native↔JS reference cycle the GC cannot break
```

**The cycle problem:** Hermes' GC can trace JS→JS references. It cannot trace through your `std::shared_ptr`. So if a HostObject holds a `jsi::Function` that closes over the HostObject's own JS wrapper, neither side ever frees. This is the #1 source of JSI memory leaks.

**Mitigations:**
- Prefer weak/raw references where the lifetime is guaranteed by structure.
- Provide an explicit `dispose()` that clears all cached `jsi::*` handles.
- Register for runtime-teardown notification and clear caches there (§27.4).

### 13.2 The lifetime rules

| Object | Lives until |
|---|---|
| `jsi::Value` / `jsi::Object` (local) | End of scope |
| `shared_ptr<jsi::Function>` member | You reset it |
| `HostObject` | GC finalizes its JS wrapper |
| `jsi::Runtime` | RN tears down the bridge/host (reload, app exit) |

**Golden rule:** *no `jsi::*` handle may outlive its `jsi::Runtime`.* If it does, destruction touches freed engine memory → crash on reload. Reloads (Fast Refresh, `r` in the dev menu) are the most common way to discover this.

### 13.3 Practical patterns

```cpp
class Module : public jsi::HostObject {
 public:
  // Called explicitly from JS, or from RN teardown
  void invalidate() {
    std::lock_guard<std::mutex> lock(mutex_);
    valid_ = false;
    listeners_.clear();     // releases all jsi::Function handles
    cache_.clear();
  }

  void emit(jsi::Runtime& rt, const jsi::Value& payload) {
    std::lock_guard<std::mutex> lock(mutex_);
    if (!valid_) return;
    for (auto& l : listeners_) {
      l->call(rt, jsi::Value(rt, payload));
    }
  }

 private:
  std::mutex mutex_;
  bool valid_ = true;
  std::vector<std::shared_ptr<jsi::Function>> listeners_;
  std::unordered_map<std::string, std::shared_ptr<jsi::Function>> cache_;
};
```

---
---

# PART IV — THREADING

## 14. The JS thread rule

> **`jsi::Runtime` is not thread-safe. Every JSI call must happen on the thread that owns the runtime.**

For the main RN runtime, that's the **JS thread**. There is no lock, no assertion in release builds, and no error message. Violating this gives you: silent heap corruption, a crash minutes later in unrelated code, or a `SIGSEGV` inside the GC. These bugs are miserable to diagnose — respect the rule mechanically.

**You are on the JS thread when:**
- inside a `HostFunction` body,
- inside `HostObject::get` / `set` / `getPropertyNames`,
- inside a `CallInvoker::invokeAsync` / `invokeSync` callback,
- inside a `RuntimeExecutor` callback,
- inside `installJSIBindingsWithRuntime:`.

**You are NOT on the JS thread when:**
- in a `dispatch_async(dispatch_get_global_queue(...))` block,
- in a `std::thread` you spawned,
- in a network/camera/sensor delegate callback,
- in a `HostObject` destructor,
- in an Android `Executor` / coroutine on `Dispatchers.IO`.

From those places you **must** hop back via a CallInvoker.

---

## 15. CallInvoker & RuntimeExecutor

### 15.1 `CallInvoker`

```cpp
// ReactCommon/callinvoker/ReactCommon/CallInvoker.h
namespace facebook::react {

using CallFunc = std::function<void(jsi::Runtime&)>;

class CallInvoker {
 public:
  // Modern form — gives you the runtime, guaranteed on the right thread
  virtual void invokeAsync(CallFunc&& func) noexcept;
  virtual void invokeAsync(SchedulerPriority priority, CallFunc&& func) noexcept;

  // Legacy form — no runtime param; you must have one from elsewhere
  virtual void invokeAsync(std::function<void()>&& func) noexcept = 0;

  // Blocks the calling thread until the work runs on the JS thread.
  // ⚠️ Deadlock risk. Use sparingly.
  virtual void invokeSync(std::function<void()>&& func);

  virtual ~CallInvoker() = default;
};

}
```

**Prefer the `CallFunc` overload** — it hands you a valid `jsi::Runtime&`, which removes the need to store one yourself (and removes the dangling-runtime class of bug entirely).

### 15.2 The canonical background-work pattern

```cpp
class Downloader : public jsi::HostObject {
 public:
  explicit Downloader(std::shared_ptr<react::CallInvoker> invoker)
      : invoker_(std::move(invoker)) {}

  jsi::Value get(jsi::Runtime& rt, const jsi::PropNameID& name) override {
    if (name.utf8(rt) == "download") {
      return jsi::Function::createFromHostFunction(
          rt, jsi::PropNameID::forAscii(rt, "download"), 2,
          [this](jsi::Runtime& rt, const jsi::Value&,
                 const jsi::Value* args, size_t count) -> jsi::Value {
            if (count < 2) throw jsi::JSError(rt, "download(url, cb)");

            auto url = args[0].asString(rt).utf8(rt);
            auto cb  = std::make_shared<jsi::Function>(
                args[1].asObject(rt).asFunction(rt));

            auto invoker = invoker_;

            // ── leave the JS thread ────────────────────────────
            std::thread([url, cb, invoker]() {
              std::string data = blockingHttpGet(url);   // slow work, off-thread

              // ── come back to the JS thread ───────────────────
              invoker->invokeAsync(
                  [cb, data = std::move(data)](jsi::Runtime& rt) {
                    cb->call(rt, jsi::String::createFromUtf8(rt, data));
                  });
            }).detach();

            return jsi::Value::undefined();
          });
    }
    return jsi::Value::undefined();
  }

 private:
  std::shared_ptr<react::CallInvoker> invoker_;
};
```

Note what crosses the thread boundary: **`std::string`, not `jsi::Value`.** Convert to plain C++ types before leaving the JS thread, and back to JSI types only inside the `invokeAsync` callback.

> ⚠️ `std::thread(...).detach()` is used here for brevity. In production use a managed thread pool — detached threads that outlive the runtime are another source of teardown crashes.

### 15.3 `RuntimeExecutor`

```cpp
using RuntimeExecutor = std::function<void(
    std::function<void(jsi::Runtime& runtime)>&& callback)>;
```

Same idea, plainer type. Used heavily by Fabric and available from `RCTHost` / `ReactContext` in bridgeless mode. `CallInvoker` is generally what a TurboModule is handed; `RuntimeExecutor` is what the framework internals pass around. Both guarantee "run this on the JS thread with a valid runtime."

### 15.4 `invokeSync` and deadlocks

```cpp
// From a background thread, block until JS runs this:
invoker->invokeSync([&]() { result = readFromJs(); });
```

Legitimate uses exist (a native API that demands a synchronous answer). But:

- ❌ Calling `invokeSync` **from the JS thread** deadlocks instantly.
- ❌ Calling it from the main thread while the JS thread is waiting on the main thread deadlocks.
- ❌ Long JS work inside it blocks your background thread.

Treat it as a last resort and document why.

---

## 16. Async callbacks and Promises from C++

### 16.1 Returning a real JS Promise

```cpp
jsi::Value createPromise(
    jsi::Runtime& rt,
    std::function<void(jsi::Runtime& rt,
                       std::shared_ptr<jsi::Function> resolve,
                       std::shared_ptr<jsi::Function> reject)> body) {

  auto promiseCtor = rt.global().getPropertyAsFunction(rt, "Promise");

  auto executor = jsi::Function::createFromHostFunction(
      rt, jsi::PropNameID::forAscii(rt, "executor"), 2,
      [body = std::move(body)](jsi::Runtime& rt, const jsi::Value&,
                               const jsi::Value* args, size_t) -> jsi::Value {
        auto resolve = std::make_shared<jsi::Function>(
            args[0].asObject(rt).asFunction(rt));
        auto reject = std::make_shared<jsi::Function>(
            args[1].asObject(rt).asFunction(rt));
        body(rt, resolve, reject);
        return jsi::Value::undefined();
      });

  return promiseCtor.callAsConstructor(rt, executor);
}
```

Used like this:

```cpp
auto readFile = [invoker](jsi::Runtime& rt, const jsi::Value&,
                          const jsi::Value* args, size_t count) -> jsi::Value {
  if (count < 1) throw jsi::JSError(rt, "readFile(path)");
  auto path = args[0].asString(rt).utf8(rt);

  return createPromise(rt,
      [path, invoker](jsi::Runtime& rt,
                      std::shared_ptr<jsi::Function> resolve,
                      std::shared_ptr<jsi::Function> reject) {
        std::thread([path, resolve, reject, invoker]() {
          try {
            std::string contents = readFileBlocking(path);
            invoker->invokeAsync([resolve, contents](jsi::Runtime& rt) {
              resolve->call(rt, jsi::String::createFromUtf8(rt, contents));
            });
          } catch (const std::exception& e) {
            std::string msg = e.what();
            invoker->invokeAsync([reject, msg](jsi::Runtime& rt) {
              auto err = rt.global()
                  .getPropertyAsFunction(rt, "Error")
                  .callAsConstructor(rt, jsi::String::createFromUtf8(rt, msg));
              reject->call(rt, err);
            });
          }
        }).detach();
      });
};
```

```js
const text = await NativeFs.readFile('/tmp/a.txt');
```

### 16.2 `AsyncPromise2` / promise helpers

React Native ships helpers in `ReactCommon/react/bridging/` (`facebook::react::AsyncPromise`, `bridging::toJs/fromJs`) that wrap this pattern with type conversion. If you're already writing a C++ TurboModule, prefer those over hand-rolling — they handle the runtime-teardown case correctly.

### 16.3 Event emitter pattern

```cpp
class EventEmitter {
 public:
  void addListener(jsi::Runtime& rt, const jsi::Value& fn) {
    std::lock_guard<std::mutex> lock(mutex_);
    listeners_.push_back(std::make_shared<jsi::Function>(
        fn.asObject(rt).asFunction(rt)));
  }

  // Callable from ANY thread
  void emit(const std::string& payload) {
    std::lock_guard<std::mutex> lock(mutex_);
    auto snapshot = listeners_;         // copy the shared_ptrs
    invoker_->invokeAsync([snapshot, payload](jsi::Runtime& rt) {
      auto arg = jsi::String::createFromUtf8(rt, payload);
      for (auto& l : snapshot) {
        l->call(rt, jsi::Value(rt, arg));
      }
    });
  }

  void clear() {
    std::lock_guard<std::mutex> lock(mutex_);
    listeners_.clear();
  }

 private:
  std::mutex mutex_;
  std::vector<std::shared_ptr<jsi::Function>> listeners_;
  std::shared_ptr<react::CallInvoker> invoker_;
};
```

---
---

# PART V — BUILDING A REAL MODULE

We'll build **`NativeCrypto`** — a module exposing a synchronous hash function and a HostObject-based key store. The C++ core is shared; only the installation glue differs per platform.

## 17. Project layout

```
my-app/
├── package.json                 ← codegenConfig
├── specs/
│   └── NativeCrypto.ts          ← TS spec (source of truth for Codegen)
├── cpp/                         ← shared C++ core
│   ├── Crypto.h
│   ├── Crypto.cpp
│   └── CryptoInstaller.h/.cpp   ← installs bindings into a runtime
├── ios/
│   ├── Crypto.mm                ← ObjC++ TurboModule that installs bindings
│   └── Podfile
└── android/
    └── app/src/main/
        ├── java/com/myapp/crypto/
        │   └── CryptoModule.kt  ← Kotlin TurboModule
        └── jni/
            ├── CMakeLists.txt
            └── OnLoad.cpp       ← JNI hybrid class
```

---

## 18. The C++ core (shared)

**`cpp/Crypto.h`**

```cpp
#pragma once
#include <jsi/jsi.h>
#include <ReactCommon/CallInvoker.h>
#include <memory>
#include <string>
#include <unordered_map>

namespace mycrypto {

namespace jsi = facebook::jsi;
namespace react = facebook::react;

// A HostObject-backed key store. Dynamic keys → HostObject is the right choice.
class KeyStore : public jsi::HostObject {
 public:
  jsi::Value get(jsi::Runtime& rt, const jsi::PropNameID& name) override;
  void set(jsi::Runtime& rt, const jsi::PropNameID& name,
           const jsi::Value& value) override;
  std::vector<jsi::PropNameID> getPropertyNames(jsi::Runtime& rt) override;

 private:
  std::unordered_map<std::string, std::string> store_;
};

// Installs `globalThis.__NativeCrypto` into the given runtime.
void install(jsi::Runtime& rt, std::shared_ptr<react::CallInvoker> invoker);

// Clears any cached JSI handles. Call before runtime teardown.
void cleanup();

} // namespace mycrypto
```

**`cpp/Crypto.cpp`**

```cpp
#include "Crypto.h"
#include <thread>

namespace mycrypto {

// ─────────────────────────── helpers ───────────────────────────

static std::string sha256Hex(const std::string& in) {
  // Replace with a real implementation (CommonCrypto / OpenSSL / a vendored lib).
  return "deadbeef" + std::to_string(in.size());
}

static jsi::Value makePromise(
    jsi::Runtime& rt,
    std::function<void(jsi::Runtime&,
                       std::shared_ptr<jsi::Function>,
                       std::shared_ptr<jsi::Function>)> body) {
  auto ctor = rt.global().getPropertyAsFunction(rt, "Promise");
  auto executor = jsi::Function::createFromHostFunction(
      rt, jsi::PropNameID::forAscii(rt, "executor"), 2,
      [body = std::move(body)](jsi::Runtime& rt, const jsi::Value&,
                               const jsi::Value* args, size_t) -> jsi::Value {
        body(rt,
             std::make_shared<jsi::Function>(args[0].asObject(rt).asFunction(rt)),
             std::make_shared<jsi::Function>(args[1].asObject(rt).asFunction(rt)));
        return jsi::Value::undefined();
      });
  return ctor.callAsConstructor(rt, executor);
}

// ─────────────────────────── KeyStore ───────────────────────────

jsi::Value KeyStore::get(jsi::Runtime& rt, const jsi::PropNameID& name) {
  auto key = name.utf8(rt);

  // Guard against JS probing this object (await, JSON.stringify, console.log)
  if (key == "then" || key == "toJSON" || key == "constructor" ||
      key.rfind("@@", 0) == 0) {
    return jsi::Value::undefined();
  }

  auto it = store_.find(key);
  if (it == store_.end()) return jsi::Value::undefined();
  return jsi::Value(rt, jsi::String::createFromUtf8(rt, it->second));
}

void KeyStore::set(jsi::Runtime& rt, const jsi::PropNameID& name,
                   const jsi::Value& value) {
  auto key = name.utf8(rt);
  if (value.isUndefined() || value.isNull()) {
    store_.erase(key);
    return;
  }
  if (!value.isString()) {
    throw jsi::JSError(rt, "KeyStore values must be strings (key: " + key + ")");
  }
  store_[key] = value.getString(rt).utf8(rt);
}

std::vector<jsi::PropNameID> KeyStore::getPropertyNames(jsi::Runtime& rt) {
  std::vector<jsi::PropNameID> out;
  out.reserve(store_.size());
  for (const auto& kv : store_) {
    out.push_back(jsi::PropNameID::forUtf8(rt, kv.first));
  }
  return out;
}

// ─────────────────────────── install ───────────────────────────

void install(jsi::Runtime& rt, std::shared_ptr<react::CallInvoker> invoker) {
  // Fixed API surface → plain Object + HostFunctions (fast path).
  jsi::Object api(rt);

  // 1. Synchronous function — impossible on the old bridge.
  api.setProperty(rt, "hashSync",
      jsi::Function::createFromHostFunction(
          rt, jsi::PropNameID::forAscii(rt, "hashSync"), 1,
          [](jsi::Runtime& rt, const jsi::Value&,
             const jsi::Value* args, size_t count) -> jsi::Value {
            if (count < 1 || !args[0].isString()) {
              throw jsi::JSError(rt, "hashSync(input: string)");
            }
            auto out = sha256Hex(args[0].getString(rt).utf8(rt));
            return jsi::Value(rt, jsi::String::createFromUtf8(rt, out));
          }));

  // 2. Async function returning a real Promise, work done off-thread.
  api.setProperty(rt, "hash",
      jsi::Function::createFromHostFunction(
          rt, jsi::PropNameID::forAscii(rt, "hash"), 1,
          [invoker](jsi::Runtime& rt, const jsi::Value&,
                    const jsi::Value* args, size_t count) -> jsi::Value {
            if (count < 1 || !args[0].isString()) {
              throw jsi::JSError(rt, "hash(input: string)");
            }
            auto input = args[0].getString(rt).utf8(rt);

            return makePromise(rt,
                [input, invoker](jsi::Runtime&,
                                 std::shared_ptr<jsi::Function> resolve,
                                 std::shared_ptr<jsi::Function> reject) {
                  std::thread([input, resolve, invoker]() {
                    auto out = sha256Hex(input);
                    invoker->invokeAsync([resolve, out](jsi::Runtime& rt) {
                      resolve->call(rt, jsi::String::createFromUtf8(rt, out));
                    });
                  }).detach();
                });
          }));

  // 3. A factory returning a HostObject.
  api.setProperty(rt, "createKeyStore",
      jsi::Function::createFromHostFunction(
          rt, jsi::PropNameID::forAscii(rt, "createKeyStore"), 0,
          [](jsi::Runtime& rt, const jsi::Value&,
             const jsi::Value*, size_t) -> jsi::Value {
            return jsi::Object::createFromHostObject(
                rt, std::make_shared<KeyStore>());
          }));

  rt.global().setProperty(rt, "__NativeCrypto", std::move(api));
}

void cleanup() {
  // Nothing cached in this example. Clear any shared_ptr<jsi::*> members here.
}

} // namespace mycrypto
```

---

## 19. iOS: wiring it up

There are three ways to get a `jsi::Runtime&` on iOS. Use the first.

### 19.1 ✅ The modern way — `RCTTurboModuleWithJSIBindings`

Verified signature from `ReactCommon/react/nativemodule/core/platform/ios/ReactCommon/RCTTurboModuleWithJSIBindings.h`:

```objc
@protocol RCTTurboModuleWithJSIBindings <NSObject>
@optional
- (void)installJSIBindingsWithRuntime:(facebook::jsi::Runtime &)runtime
                          callInvoker:(const std::shared_ptr<facebook::react::CallInvoker> &)callinvoker;

- (void)installJSIBindingsWithRuntime:(facebook::jsi::Runtime &)runtime
    __attribute__((deprecated("Use 'installJSIBindingsWithRuntime:callInvoker:' instead")));
@end
```

**`ios/Crypto.mm`** (note: `.mm`, not `.m` — you need Objective-C++)

```objc
#import <React/RCTBridgeModule.h>
#import <ReactCommon/RCTTurboModule.h>
#import <ReactCommon/RCTTurboModuleWithJSIBindings.h>
#import "NativeCryptoSpec/NativeCryptoSpec.h"   // generated by Codegen
#import "Crypto.h"

@interface Crypto : NSObject <NativeCryptoSpec, RCTTurboModuleWithJSIBindings>
@end

@implementation Crypto

RCT_EXPORT_MODULE()

// Required by the Codegen spec: the TurboModule's C++ counterpart.
- (std::shared_ptr<facebook::react::TurboModule>)getTurboModule:
    (const facebook::react::ObjCTurboModule::InitParams &)params
{
  return std::make_shared<facebook::react::NativeCryptoSpecJSI>(params);
}

// ── The hook. Called on the JS thread with a live runtime. ──
- (void)installJSIBindingsWithRuntime:(facebook::jsi::Runtime &)runtime
                          callInvoker:(const std::shared_ptr<facebook::react::CallInvoker> &)callInvoker
{
  mycrypto::install(runtime, callInvoker);
}

// A trivial spec method so JS has something to call to force module init.
- (NSNumber *)install
{
  return @YES;
}

- (void)invalidate
{
  mycrypto::cleanup();
}

@end
```

**Why is there still an `install()` method?** TurboModules are **lazy** — the native class isn't instantiated until JS first touches it. `installJSIBindingsWithRuntime:` therefore doesn't run until something pulls the module in. So JS does this once at startup:

```ts
import NativeCrypto from './specs/NativeCrypto';
NativeCrypto.install();          // forces module creation → bindings installed
```

### 19.2 The bridge way (legacy — avoid in new code)

```objc
RCT_EXPORT_BLOCKING_SYNCHRONOUS_METHOD(install)
{
  RCTBridge *bridge = [RCTBridge currentBridge];
  RCTCxxBridge *cxxBridge = (RCTCxxBridge *)bridge;
  if (cxxBridge.runtime == nullptr) { return @NO; }
  auto &runtime = *(facebook::jsi::Runtime *)cxxBridge.runtime;
  mycrypto::install(runtime, bridge.jsCallInvoker);
  return @YES;
}
```

⚠️ `RCTBridge` does not exist in bridgeless mode. This pattern is why many older libraries broke on RN 0.74+. Don't build on it.

### 19.3 The pure-C++ TurboModule way

Subclass `facebook::react::TurboModule` directly and implement
`facebook::react::TurboModuleWithJSIBindings` (verified from
`ReactCommon/react/nativemodule/core/ReactCommon/TurboModuleWithJSIBindings.h`):

```cpp
class TurboModuleWithJSIBindings {
 public:
  virtual ~TurboModuleWithJSIBindings() = default;
  static void installJSIBindings(const std::shared_ptr<TurboModule>& cxxModule,
                                 jsi::Runtime& runtime);
 private:
  virtual void installJSIBindingsWithRuntime(jsi::Runtime& runtime) = 0;
};
```

This gives you **one implementation for both platforms** — no ObjC++, no JNI. It's the direction the ecosystem is heading (and what Nitro does under the hood).

### 19.4 Podspec / build settings

If you're shipping a library, `MyCrypto.podspec`:

```ruby
Pod::Spec.new do |s|
  s.name         = "MyCrypto"
  s.version      = "1.0.0"
  s.source_files = "ios/**/*.{h,m,mm}", "cpp/**/*.{h,cpp}"
  s.platforms    = { :ios => "15.1" }
  s.pod_target_xcconfig = {
    "CLANG_CXX_LANGUAGE_STANDARD" => "c++20",
    "HEADER_SEARCH_PATHS" => "\"$(PODS_ROOT)/boost\" \"$(PODS_TARGET_SRCROOT)/cpp\""
  }
  install_modules_dependencies(s)   # pulls in React-Core, ReactCommon, hermes, jsi
end
```

For an app-local module, add the `cpp/` folder to your Xcode target and set **C++ Language Dialect → C++20** and **Header Search Paths** to include it.

---

## 20. Android: wiring it up

Android needs a JNI hop: Kotlin → C++.

### 20.1 The Kotlin interface

Verified from `ReactAndroid/src/main/java/com/facebook/react/turbomodule/core/interfaces/TurboModuleWithJSIBindings.kt`:

```kotlin
public interface TurboModuleWithJSIBindings {
  public fun getBindingsInstaller(): BindingsInstallerHolder
}
```

`BindingsInstallerHolder` is a Java holder wrapping a C++ `HybridData` — the C++ side supplies a `std::function<void(jsi::Runtime&, const std::shared_ptr<CallInvoker>&)>`.

### 20.2 `android/app/src/main/java/com/myapp/crypto/CryptoModule.kt`

```kotlin
package com.myapp.crypto

import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.module.annotations.ReactModule
import com.facebook.react.turbomodule.core.interfaces.BindingsInstallerHolder
import com.facebook.react.turbomodule.core.interfaces.TurboModuleWithJSIBindings
import com.myapp.NativeCryptoSpec   // generated by Codegen

@ReactModule(name = CryptoModule.NAME)
class CryptoModule(reactContext: ReactApplicationContext) :
    NativeCryptoSpec(reactContext), TurboModuleWithJSIBindings {

  companion object {
    const val NAME = "Crypto"
    init { System.loadLibrary("mycrypto") }
  }

  override fun getName() = NAME

  override fun getBindingsInstaller(): BindingsInstallerHolder =
      getBindingsInstallerNative()

  // Trivial spec method — forces the module to be created from JS.
  override fun install(): Boolean = true

  override fun invalidate() {
    cleanupNative()
    super.invalidate()
  }

  private external fun getBindingsInstallerNative(): BindingsInstallerHolder
  private external fun cleanupNative()
}
```

### 20.3 The JNI layer — `android/app/src/main/jni/OnLoad.cpp`

```cpp
#include <fbjni/fbjni.h>
#include <jsi/jsi.h>
#include <ReactCommon/CallInvoker.h>
#include <react/nativemodule/core/ReactCommon/BindingsInstallerHolder.h>
#include "Crypto.h"

namespace mycrypto {

using namespace facebook;

struct CryptoModuleJni : jni::JavaClass<CryptoModuleJni> {
  static constexpr auto kJavaDescriptor = "Lcom/myapp/crypto/CryptoModule;";

  static jni::local_ref<react::BindingsInstallerHolder::javaobject>
  getBindingsInstallerNative(jni::alias_ref<jni::JClass>) {
    return react::BindingsInstallerHolder::newObjCxxInstance(
        [](jsi::Runtime& runtime,
           const std::shared_ptr<react::CallInvoker>& callInvoker) {
          mycrypto::install(runtime, callInvoker);
        });
  }

  static void cleanupNative(jni::alias_ref<jni::JClass>) {
    mycrypto::cleanup();
  }

  static void registerNatives() {
    javaClassStatic()->registerNatives({
        makeNativeMethod("getBindingsInstallerNative",
                         CryptoModuleJni::getBindingsInstallerNative),
        makeNativeMethod("cleanupNative", CryptoModuleJni::cleanupNative),
    });
  }
};

} // namespace mycrypto

JNIEXPORT jint JNICALL JNI_OnLoad(JavaVM* vm, void*) {
  return facebook::jni::initialize(vm, [] {
    mycrypto::CryptoModuleJni::registerNatives();
  });
}
```

> The exact factory name on `BindingsInstallerHolder` has shifted across RN versions. Check
> `node_modules/react-native/ReactCommon/react/nativemodule/core/ReactCommon/BindingsInstallerHolder.h`
> in *your* RN version and match its constructor/`newObjCxxInstance` signature. In 0.86 it accepts
> either `BindingsInstallFunc` (runtime + callInvoker) or the legacy runtime-only `std::function`.

### 20.4 `android/app/src/main/jni/CMakeLists.txt`

```cmake
cmake_minimum_required(VERSION 3.13)
project(mycrypto)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_VERBOSE_MAKEFILE ON)

# RN 0.71+ ships a CMake package
find_package(ReactAndroid REQUIRED CONFIG)
find_package(fbjni REQUIRED CONFIG)

add_library(mycrypto SHARED
    OnLoad.cpp
    ../../../../../cpp/Crypto.cpp
)

target_include_directories(mycrypto PRIVATE
    ../../../../../cpp
)

target_link_libraries(mycrypto
    ReactAndroid::reactnative    # RN 0.76+: one merged .so
    ReactAndroid::jsi
    fbjni::fbjni
    android
    log
)
```

> On RN **0.75 and earlier**, the targets were split: link `ReactAndroid::react_nativemodule_core`,
> `ReactAndroid::turbomodulejsijni`, `ReactAndroid::react_render_core`, etc. From **0.76** they were
> merged into the single `ReactAndroid::reactnative`. Check
> `node_modules/react-native/ReactAndroid/cmake-utils/` for what your version exports.

### 20.5 `android/app/build.gradle`

```gradle
android {
    defaultConfig {
        externalNativeBuild {
            cmake {
                arguments "-DANDROID_STL=c++_shared"
                cppFlags "-std=c++20", "-frtti", "-fexceptions"
                abiFilters "armeabi-v7a", "arm64-v8a", "x86", "x86_64"
            }
        }
    }
    externalNativeBuild {
        cmake {
            path "src/main/jni/CMakeLists.txt"
            version "3.22.1"
        }
    }
    packagingOptions {
        // Avoid bundling RN's own .so files twice
        pickFirst "**/libc++_shared.so"
    }
}
```

`-frtti` matters: `jsi::Object::isHostObject<T>()` uses `dynamic_cast`. Without RTTI it silently misbehaves.

### 20.6 Registering the package

```kotlin
class CryptoPackage : BaseReactPackage() {
  override fun getModule(name: String, ctx: ReactApplicationContext): NativeModule? =
      if (name == CryptoModule.NAME) CryptoModule(ctx) else null

  override fun getReactModuleInfoProvider() = ReactModuleInfoProvider {
    mapOf(
        CryptoModule.NAME to ReactModuleInfo(
            name = CryptoModule.NAME,
            className = CryptoModule.NAME,
            canOverrideExistingModule = false,
            needsEagerInit = false,
            isCxxModule = false,
            isTurboModule = true))
  }
}
```

Add it in `MainApplication.kt`:

```kotlin
override fun getPackages(): List<ReactPackage> =
    PackageList(this).packages.apply { add(CryptoPackage()) }
```

---

## 21. The TypeScript side

### 21.1 The Codegen spec — `specs/NativeCrypto.ts`

```ts
import type { TurboModule } from 'react-native';
import { TurboModuleRegistry } from 'react-native';

export interface Spec extends TurboModule {
  // Only needs to expose the trigger; the real API lands on globalThis.
  install(): boolean;
}

export default TurboModuleRegistry.getEnforcing<Spec>('Crypto');
```

Register it in `package.json`:

```json
{
  "codegenConfig": {
    "name": "NativeCryptoSpec",
    "type": "modules",
    "jsSrcsDir": "specs",
    "android": { "javaPackageName": "com.myapp" }
  }
}
```

**Codegen rules to remember:**
- The file **must** be named `Native<Something>.ts` and live in `jsSrcsDir`.
- It **must** export an interface named exactly `Spec`.
- Only Codegen-supported types are allowed: `boolean`, `number`, `string`, `Object`, `Array<T>`, `void`, `Promise<T>`, `?T` (nullable), function/callback types, and object literal types. No unions of literals as return types, no generics of your own, no `any`.
- Regenerate: `cd ios && pod install` (iOS) / any Gradle build (Android). Output lands in `ios/build/generated/ios/` and `android/app/build/generated/source/codegen/`.

### 21.2 The typed JS wrapper

```ts
// src/NativeCrypto.ts
import NativeCryptoModule from '../specs/NativeCrypto';

export interface KeyStore {
  [key: string]: string | undefined;
}

interface NativeCryptoApi {
  hashSync(input: string): string;
  hash(input: string): Promise<string>;
  createKeyStore(): KeyStore;
}

declare global {
  // eslint-disable-next-line no-var
  var __NativeCrypto: NativeCryptoApi | undefined;
}

let installed = false;

function ensureInstalled(): NativeCryptoApi {
  if (!installed) {
    const ok = NativeCryptoModule.install();
    if (!ok) throw new Error('Failed to install NativeCrypto JSI bindings');
    installed = true;
  }
  if (global.__NativeCrypto == null) {
    throw new Error('NativeCrypto bindings not found on global');
  }
  return global.__NativeCrypto;
}

export const Crypto = {
  hashSync: (input: string) => ensureInstalled().hashSync(input),
  hash: (input: string) => ensureInstalled().hash(input),
  createKeyStore: () => ensureInstalled().createKeyStore(),
};
```

Usage:

```ts
import { Crypto } from './src/NativeCrypto';

const h = Crypto.hashSync('hello');   // synchronous! no await, no bridge
const h2 = await Crypto.hash('hello');

const store = Crypto.createKeyStore();
store.token = 'abc123';               // → KeyStore::set
console.log(store.token);             // → KeyStore::get
console.log(Object.keys(store));      // → KeyStore::getPropertyNames
delete store.token;                   // ⚠️ NOT intercepted — see below
```

> ⚠️ `delete obj.key` on a HostObject is **not** routed to your C++ (there's no `deleteProperty` hook in JSI). Model deletion as `store.key = undefined` (which our `set()` handles) or expose an explicit `remove()` method.

---
---

# PART VI — ADVANCED

## 22. Zero-copy binary data

This is the single biggest practical win of JSI over the bridge. On the bridge, a 10 MB image had to be base64'd into a string (≈13 MB), serialized, shipped, parsed, and decoded. With JSI, JS reads the **same bytes** the native side wrote.

### 22.1 `MutableBuffer`

```cpp
// jsi.h
class JSI_EXPORT MutableBuffer {
 public:
  virtual ~MutableBuffer();
  virtual size_t size() const = 0;
  virtual uint8_t* data() = 0;
};
```

Implement it over memory you own:

```cpp
class VectorBuffer : public jsi::MutableBuffer {
 public:
  explicit VectorBuffer(std::vector<uint8_t>&& data)
      : data_(std::move(data)) {}
  size_t size() const override { return data_.size(); }
  uint8_t* data() override { return data_.data(); }
 private:
  std::vector<uint8_t> data_;
};
```

Hand it to JS as an ArrayBuffer with **no copy**:

```cpp
auto readImage = [](jsi::Runtime& rt, const jsi::Value&,
                    const jsi::Value* args, size_t count) -> jsi::Value {
  std::vector<uint8_t> pixels = decodeImage(/* ... */);   // large
  auto buffer = std::make_shared<VectorBuffer>(std::move(pixels));
  return jsi::ArrayBuffer(rt, buffer);   // zero copy — JS points at your memory
};
```

```js
const buf = NativeImage.readImage('/photo.jpg');   // ArrayBuffer
const px  = new Uint8Array(buf);                   // still zero copy
px[0] = 255;                                       // ⚠️ mutates YOUR C++ memory
```

**Lifetime:** the `shared_ptr<MutableBuffer>` is retained by the JS ArrayBuffer. Your memory stays alive as long as JS holds it, and is freed when the ArrayBuffer is collected. That's the contract — do not `free()` the underlying storage yourself.

### 22.2 Reading a TypedArray from JS

```cpp
auto process = [](jsi::Runtime& rt, const jsi::Value&,
                  const jsi::Value* args, size_t count) -> jsi::Value {
  auto obj = args[0].asObject(rt);

  // If JS passed a Uint8Array, get its underlying buffer + offsets
  if (!obj.isArrayBuffer(rt)) {
    auto ab     = obj.getPropertyAsObject(rt, "buffer").getArrayBuffer(rt);
    auto offset = static_cast<size_t>(obj.getProperty(rt, "byteOffset").asNumber());
    auto len    = static_cast<size_t>(obj.getProperty(rt, "byteLength").asNumber());
    uint8_t* p  = ab.data(rt) + offset;
    doWork(p, len);
    return jsi::Value::undefined();
  }

  auto ab = obj.getArrayBuffer(rt);
  doWork(ab.data(rt), ab.size(rt));
  return jsi::Value::undefined();
};
```

⚠️ The pointer from `data(rt)` is only valid **while you're on the JS thread and the buffer isn't detached**. Never stash it and use it later from another thread — copy the bytes if you need them off-thread.

---

## 23. Installing globals & runtime-agnostic code

### 23.1 Naming

Globals you install are visible to all app JS. Namespace them and mark them internal:

```cpp
rt.global().setProperty(rt, "__MyLibInternal", std::move(api));
```

Then wrap in TS so nobody depends on the global directly. Libraries that expose a bare `MyLib` global collide with each other and with user code.

### 23.2 Idempotent installation

Fast Refresh can re-run your JS but *not* re-create the runtime. Installation must be safe to call twice:

```cpp
void install(jsi::Runtime& rt, std::shared_ptr<react::CallInvoker> invoker) {
  if (rt.global().hasProperty(rt, "__NativeCrypto")) {
    return;   // already installed in this runtime
  }
  // ...
}
```

Conversely, a **full reload creates a new runtime**, so anything cached in a C++ static keyed to the old runtime is now poison. Prefer storing per-runtime state in the runtime itself (as a global, or via `NativeState`) rather than in file-scope statics.

### 23.3 Runtime-agnostic C++

Write your install function to take only `jsi::Runtime&` + `CallInvoker`. Then the same code installs into:
- the main RN runtime,
- a Reanimated/Worklets UI runtime,
- a test runtime you create in a C++ unit test,
- a standalone Hermes runtime in a CLI tool.

That last one is genuinely useful — you can unit-test JSI code without an app:

```cpp
// test/CryptoTest.cpp
#include <hermes/hermes.h>
#include "Crypto.h"

TEST(Crypto, hashSyncWorks) {
  auto rt = facebook::hermes::makeHermesRuntime();
  mycrypto::install(*rt, nullptr);
  auto result = rt->evaluateJavaScript(
      std::make_shared<jsi::StringBuffer>("__NativeCrypto.hashSync('a')"),
      "test.js");
  EXPECT_TRUE(result.isString());
}
```

---

## 24. Secondary runtimes: Worklets

Reanimated (and `react-native-worklets`) creates a **second Hermes runtime** on a separate thread (the "UI runtime"). This is only possible because of JSI.

```
┌──────────────────┐        ┌──────────────────┐
│  JS thread       │        │  UI thread       │
│  Main runtime    │        │  UI runtime      │
│  (React, logic)  │        │  (worklets)      │
└────────┬─────────┘        └─────────┬────────┘
         │                            │
         │  runOnUI(fn)               │  runOnJS(fn)
         └──────────────────────────► │ ◄──────────────┘
              (serialized closure)
```

Key implications:

- ⚠️ **Values do not cross runtimes.** A `jsi::Object` from the main runtime is invalid in the UI runtime. Worklets *serialize* closures across, which is why worklets can only capture plain data.
- ✅ If your HostObject should be usable from worklets, install it into **both** runtimes. Libraries like MMKV and VisionCamera do exactly this.
- ⚠️ Your C++ state is now accessed from two threads. Add real synchronization.

```cpp
// Install into both runtimes; each gets its own jsi::Object wrapper
// but they can share the same underlying C++ shared_ptr state.
void installEverywhere(jsi::Runtime& mainRt, jsi::Runtime& uiRt,
                       std::shared_ptr<SharedState> state) {
  installInto(mainRt, state);
  installInto(uiRt, state);   // state must be thread-safe!
}
```

---

## 25. Synchronous calls

JSI makes sync native calls possible. That doesn't make them free.

**A synchronous native call blocks the JS thread.** While it runs:
- no React rendering,
- no timers, no promises resolving,
- no touch handling in JS,
- and if it takes >16ms, you drop frames.

| Good sync candidates | Bad sync candidates |
|---|---|
| Read an in-memory value (MMKV get) | Network requests |
| A fast pure computation (<1ms) | File I/O on large files |
| Device constants (screen size, locale) | Database queries |
| A math/crypto op on small input | Image decoding |
| Getting a handle/pointer | Anything involving the main thread |

**Rule:** if it can block for more than a frame budget, make it async and hop threads (§15.2). "It's synchronous now!" is not automatically an improvement — it's a tool for the cases where a round trip was the bottleneck, not the work.

---
---

# PART VII — ECOSYSTEM & PRACTICE

## 26. JSI vs TurboModules vs Nitro

These are three **layers**, not three competing choices.

```
┌───────────────────────────────────────────────┐
│  Nitro Modules  (3rd party, codegen-heavy)    │
├───────────────────────────────────────────────┤
│  TurboModules   (RN's typed module system)    │
├───────────────────────────────────────────────┤
│  JSI            (the raw C++ ↔ JS interface)  │
├───────────────────────────────────────────────┤
│  Hermes / JSC / V8                            │
└───────────────────────────────────────────────┘
```

### 26.1 TurboModules

A TurboModule *is* a JSI HostObject — one that RN generates for you from a TS spec.

- ✅ Type-safe end to end (Codegen validates JS↔native signatures at build time).
- ✅ Lazy initialization.
- ✅ Automatic argument marshalling.
- ✅ Works with Obj-C/Swift/Kotlin/Java — no C++ required.
- ❌ Limited type vocabulary (no HostObjects as arguments, no ArrayBuffers in the spec, no C++ objects returned).
- ❌ Values are still converted (`NSDictionary`/`ReadableMap`), so it's not zero-copy.

### 26.2 Raw JSI

- ✅ Full power: HostObjects, zero-copy buffers, custom shapes, secondary runtimes.
- ✅ Fastest possible.
- ❌ You write and maintain C++ + ObjC++ + JNI + CMake.
- ❌ No type safety unless you hand-write the `.d.ts`.
- ❌ You own the threading and lifetime correctness.

### 26.3 Nitro Modules

`react-native-nitro-modules` — a third-party framework (mrousavy) that generates JSI HostObject bindings from TS specs.

- ✅ Type-safe *and* HostObject-fast.
- ✅ Supports rich types TurboModules can't: ArrayBuffers, other Nitro objects, functions, variants.
- ✅ Swift and Kotlin support without hand-written JNI/ObjC++ glue.
- ❌ Third-party dependency; its own codegen step and mental model.

### 26.4 Decision table

| Your need | Use |
|---|---|
| Standard module, JSON-ish data, async is fine | **TurboModule** |
| Same, but you want Swift/Kotlin + richer types | **Nitro** |
| Large binary buffers, zero-copy | **Raw JSI** (or Nitro's ArrayBuffer) |
| A stateful native object JS holds a handle to | **Raw JSI HostObject** or **Nitro** |
| Must run inside a worklet / UI runtime | **Raw JSI** |
| Sub-microsecond synchronous reads (KV store) | **Raw JSI** |
| Your first native module | **TurboModule** — start here |

**Honest advice:** most modules should be TurboModules. Reach for raw JSI when you have a measured reason — a profile showing serialization cost, a buffer you can't afford to copy, or a stateful object model that TurboModules can't express.

### 26.5 Real-world examples worth reading

| Library | What it uses JSI for |
|---|---|
| **react-native-mmkv** | HostObject with sync get/set — the canonical simple example |
| **react-native-reanimated** | A second runtime + worklet serialization |
| **react-native-vision-camera** | Zero-copy frame buffers to frame processors |
| **react-native-quick-sqlite** | Sync DB queries, HostObject connections |
| **op-sqlite** | Same, modernized; good CMake reference |
| **react-native-skia** | Huge HostObject API surface over Skia |

Reading MMKV's `MmkvHostObject.cpp` end to end is about 250 lines and teaches more than any tutorial.

---

## 27. Debugging & common crashes

### 27.1 The classic crashes

| Symptom | Cause | Fix |
|---|---|---|
| Crash on **reload** only | `jsi::*` handle outlived the runtime | Clear caches in `invalidate()` |
| `SIGSEGV` inside GC | Runtime touched off the JS thread | Route through `CallInvoker` |
| `SIGABRT` on `getNumber()` | Used `get*` on a wrong-typed value | Use `as*` or check `is*` first |
| Works debug, crashes release | Out-of-bounds `args[i]` (`i >= count`) | Check `count` |
| `isHostObject` always false | RTTI disabled | Add `-frtti` |
| `undefined is not an object` on the global | `install()` never called / module lazy | Call the trigger method at startup |
| Random corruption after some minutes | Data race on C++ state shared with a worklet | Add a mutex |
| Function works once, then dangles | Lambda captured `this` or a reference that died | Capture `shared_ptr` by value |
| `dlopen` failed / `UnsatisfiedLinkError` | `System.loadLibrary` name ≠ CMake target | Match the names exactly |

### 27.2 Reading a native crash

**iOS:** Xcode → Debug → Debug Workflow → Always Show Disassembly off; run with the **Address Sanitizer** and **Thread Sanitizer** schemes on. TSan finds the "touched the runtime off-thread" class of bug immediately, which is worth the slowdown.

**Android:** `adb logcat | grep -E "SIGSEGV|backtrace|libmycrypto"`, then symbolicate:

```bash
$ANDROID_NDK/ndk-stack -sym android/app/build/intermediates/cmake/debug/obj/arm64-v8a \
    -dump crash.txt
```

### 27.3 A thread assertion worth having

```cpp
#ifndef NDEBUG
#include <thread>
static std::thread::id g_jsThreadId;

inline void markJsThread() { g_jsThreadId = std::this_thread::get_id(); }

inline void assertJsThread(const char* where) {
  if (std::this_thread::get_id() != g_jsThreadId) {
    __builtin_trap();   // break here in the debugger
  }
}
#define ASSERT_JS_THREAD() assertJsThread(__func__)
#else
#define ASSERT_JS_THREAD() ((void)0)
#endif
```

Call `markJsThread()` in your install function and `ASSERT_JS_THREAD()` at the top of every function that touches the runtime. This catches threading bugs at the moment they happen, not three minutes later in the GC.

### 27.4 Handling runtime teardown

The most reliable hook is the platform module lifecycle:

- **iOS:** implement `- (void)invalidate` on your module (called on bridge/host teardown).
- **Android:** override `invalidate()` on your `NativeModule`.

Both should call into C++ and drop every `jsi::*` handle you hold.

There is also a JSI-level trick: attach a HostObject whose destructor signals teardown.

```cpp
class RuntimeLifecycleMonitor : public jsi::HostObject {
 public:
  explicit RuntimeLifecycleMonitor(std::function<void()> onDestroy)
      : onDestroy_(std::move(onDestroy)) {}
  ~RuntimeLifecycleMonitor() override { onDestroy_(); }
 private:
  std::function<void()> onDestroy_;
};

// In install():
rt.global().setProperty(rt, "__myLibLifecycle",
    jsi::Object::createFromHostObject(rt,
        std::make_shared<RuntimeLifecycleMonitor>([]{ mycrypto::cleanup(); })));
```

⚠️ Per the `jsi.h` comment, this destructor runs on an arbitrary thread and possibly very late. Use it as a backstop, not the primary mechanism.

### 27.5 Logging from C++

```cpp
#if defined(__ANDROID__)
  #include <android/log.h>
  #define LOGI(...) __android_log_print(ANDROID_LOG_INFO, "MyLib", __VA_ARGS__)
#else
  #include <os/log.h>
  #define LOGI(fmt, ...) os_log(OS_LOG_DEFAULT, fmt, ##__VA_ARGS__)
#endif
```

Or route to JS `console.log` (JS thread only):

```cpp
void jsLog(jsi::Runtime& rt, const std::string& msg) {
  rt.global()
    .getPropertyAsObject(rt, "console")
    .getPropertyAsFunction(rt, "log")
    .call(rt, jsi::String::createFromUtf8(rt, "[native] " + msg));
}
```

---

## 28. Performance

### 28.1 Rough cost model (order-of-magnitude, Hermes, modern device)

| Operation | Approx cost |
|---|---|
| JS→JS function call | ~1 ns |
| HostFunction call (no args) | ~50–200 ns |
| HostObject `get()` with `utf8()` + map lookup | ~200–500 ns |
| `String::createFromUtf8` (short) | ~100–300 ns |
| `String::utf8()` (short) | ~100–300 ns |
| Old bridge round trip | ~1,000,000+ ns (async, batched) |
| ArrayBuffer creation (zero-copy) | ~100 ns regardless of size |
| Copying 1 MB through JSON | ~10,000,000 ns |

Take the exact numbers with salt — measure on your device. The **ratios** are the point: JSI calls are ~4 orders of magnitude cheaper than bridge calls, and string conversion is the dominant per-call cost in most JSI modules.

### 28.2 The optimization checklist

1. **Don't allocate `jsi::Function`s in `get()`.** Cache them, or use a plain Object (§10.3).
2. **Avoid `PropNameID::utf8()` in hot paths.** It allocates.
3. **Batch.** One call returning 1000 items beats 1000 calls returning one.
4. **Use ArrayBuffer for bulk data.** Never build a giant JS array element by element if a buffer will do.
5. **Prefer `NativeState` over `HostObject`** when the shape is fixed — normal property access is inline-cached by the engine.
6. **Reserve capacity** on `std::vector`/`jsi::Array` when you know the size.
7. **Move, don't copy.** `std::move` your strings and vectors into lambdas.
8. **Don't cross threads unnecessarily.** Each `invokeAsync` is a queue hop with real latency.

### 28.3 Benchmarking honestly

```ts
function bench(name: string, fn: () => void, iterations = 100_000) {
  fn();                                       // warm up (JIT/IC)
  const start = global.performance.now();
  for (let i = 0; i < iterations; i++) fn();
  const total = global.performance.now() - start;
  console.log(`${name}: ${(total / iterations * 1000).toFixed(3)} µs/op`);
}

bench('jsi sync', () => Crypto.hashSync('hello'));
```

Benchmark in a **release build** on a **real device**. Debug Hermes and the simulator are both wildly unrepresentative, and Chrome-debugger mode doesn't even use Hermes.

---

## 29. Complete worked example

Everything above, assembled: a persistent key-value store with a synchronous JSI API. This is deliberately close to how MMKV works.

**`cpp/Store.h`**

```cpp
#pragma once
#include <jsi/jsi.h>
#include <ReactCommon/CallInvoker.h>
#include <mutex>
#include <string>
#include <unordered_map>

namespace mystore {

namespace jsi = facebook::jsi;
namespace react = facebook::react;

class Store : public jsi::HostObject,
              public std::enable_shared_from_this<Store> {
 public:
  explicit Store(std::string path);
  ~Store() override;

  jsi::Value get(jsi::Runtime& rt, const jsi::PropNameID& name) override;
  std::vector<jsi::PropNameID> getPropertyNames(jsi::Runtime& rt) override;

  void invalidate();

 private:
  jsi::Value makeFn(jsi::Runtime& rt, const std::string& name,
                    unsigned int arity, jsi::HostFunctionType fn);

  std::string path_;
  std::mutex mutex_;
  bool valid_ = true;
  std::unordered_map<std::string, std::string> data_;
  std::unordered_map<std::string, std::shared_ptr<jsi::Function>> fnCache_;
};

void install(jsi::Runtime& rt, std::shared_ptr<react::CallInvoker> invoker);
void cleanup();

} // namespace mystore
```

**`cpp/Store.cpp`**

```cpp
#include "Store.h"
#include <fstream>

namespace mystore {

// ─── persistence (toy implementation) ───

static std::unordered_map<std::string, std::string> loadFrom(const std::string& p) {
  std::unordered_map<std::string, std::string> out;
  std::ifstream in(p);
  std::string k, v;
  while (std::getline(in, k) && std::getline(in, v)) out[k] = v;
  return out;
}

static void saveTo(const std::string& p,
                   const std::unordered_map<std::string, std::string>& d) {
  std::ofstream out(p, std::ios::trunc);
  for (const auto& kv : d) out << kv.first << "\n" << kv.second << "\n";
}

// ─── Store ───

Store::Store(std::string path) : path_(std::move(path)) {
  data_ = loadFrom(path_);
}

Store::~Store() {
  // Runs on an arbitrary thread, inside the GC. No runtime access.
  // fnCache_ MUST already be empty — invalidate() should have run.
  // Persisting here is acceptable only because it touches no JSI.
  try { saveTo(path_, data_); } catch (...) {}
}

void Store::invalidate() {
  std::lock_guard<std::mutex> lock(mutex_);
  valid_ = false;
  fnCache_.clear();          // release all JS handles before teardown
  saveTo(path_, data_);
}

jsi::Value Store::makeFn(jsi::Runtime& rt, const std::string& name,
                         unsigned int arity, jsi::HostFunctionType fn) {
  auto it = fnCache_.find(name);
  if (it != fnCache_.end()) {
    return jsi::Value(rt, *it->second);      // explicit handle copy
  }
  auto created = jsi::Function::createFromHostFunction(
      rt, jsi::PropNameID::forUtf8(rt, name), arity, std::move(fn));
  auto stored = std::make_shared<jsi::Function>(std::move(created));
  fnCache_[name] = stored;
  return jsi::Value(rt, *stored);
}

jsi::Value Store::get(jsi::Runtime& rt, const jsi::PropNameID& name) {
  auto prop = name.utf8(rt);

  // Never throw on unknown/probe keys — JS reads `then`, `toJSON`,
  // Symbol.toPrimitive etc. on arbitrary objects.
  if (prop == "then" || prop == "toJSON" || prop.rfind("@@", 0) == 0) {
    return jsi::Value::undefined();
  }

  auto self = shared_from_this();   // keep alive for the lambdas' lifetime

  if (prop == "getString") {
    return makeFn(rt, "getString", 1,
        [self](jsi::Runtime& rt, const jsi::Value&,
               const jsi::Value* args, size_t count) -> jsi::Value {
          if (count < 1 || !args[0].isString()) {
            throw jsi::JSError(rt, "getString(key: string)");
          }
          auto key = args[0].getString(rt).utf8(rt);
          std::lock_guard<std::mutex> lock(self->mutex_);
          if (!self->valid_) throw jsi::JSError(rt, "Store has been closed");
          auto it = self->data_.find(key);
          if (it == self->data_.end()) return jsi::Value::undefined();
          return jsi::Value(rt, jsi::String::createFromUtf8(rt, it->second));
        });
  }

  if (prop == "set") {
    return makeFn(rt, "set", 2,
        [self](jsi::Runtime& rt, const jsi::Value&,
               const jsi::Value* args, size_t count) -> jsi::Value {
          if (count < 2 || !args[0].isString() || !args[1].isString()) {
            throw jsi::JSError(rt, "set(key: string, value: string)");
          }
          auto key = args[0].getString(rt).utf8(rt);
          auto val = args[1].getString(rt).utf8(rt);
          std::lock_guard<std::mutex> lock(self->mutex_);
          if (!self->valid_) throw jsi::JSError(rt, "Store has been closed");
          self->data_[key] = std::move(val);
          return jsi::Value::undefined();
        });
  }

  if (prop == "remove") {
    return makeFn(rt, "remove", 1,
        [self](jsi::Runtime& rt, const jsi::Value&,
               const jsi::Value* args, size_t count) -> jsi::Value {
          if (count < 1 || !args[0].isString()) {
            throw jsi::JSError(rt, "remove(key: string)");
          }
          auto key = args[0].getString(rt).utf8(rt);
          std::lock_guard<std::mutex> lock(self->mutex_);
          self->data_.erase(key);
          return jsi::Value::undefined();
        });
  }

  if (prop == "getAllKeys") {
    return makeFn(rt, "getAllKeys", 0,
        [self](jsi::Runtime& rt, const jsi::Value&,
               const jsi::Value*, size_t) -> jsi::Value {
          std::lock_guard<std::mutex> lock(self->mutex_);
          jsi::Array out(rt, self->data_.size());
          size_t i = 0;
          for (const auto& kv : self->data_) {
            out.setValueAtIndex(rt, i++,
                jsi::String::createFromUtf8(rt, kv.first));
          }
          return jsi::Value(rt, out);
        });
  }

  if (prop == "size") {
    std::lock_guard<std::mutex> lock(mutex_);
    return jsi::Value(static_cast<double>(data_.size()));
  }

  if (prop == "close") {
    return makeFn(rt, "close", 0,
        [self](jsi::Runtime&, const jsi::Value&,
               const jsi::Value*, size_t) -> jsi::Value {
          self->invalidate();
          return jsi::Value::undefined();
        });
  }

  return jsi::Value::undefined();
}

std::vector<jsi::PropNameID> Store::getPropertyNames(jsi::Runtime& rt) {
  std::vector<jsi::PropNameID> out;
  for (const char* n : {"getString", "set", "remove", "getAllKeys",
                        "size", "close"}) {
    out.push_back(jsi::PropNameID::forAscii(rt, n));
  }
  return out;
}

// ─── install ───

static std::vector<std::weak_ptr<Store>> g_stores;
static std::mutex g_storesMutex;

void install(jsi::Runtime& rt, std::shared_ptr<react::CallInvoker>) {
  if (rt.global().hasProperty(rt, "__MyStore")) return;   // idempotent

  auto open = jsi::Function::createFromHostFunction(
      rt, jsi::PropNameID::forAscii(rt, "open"), 1,
      [](jsi::Runtime& rt, const jsi::Value&,
         const jsi::Value* args, size_t count) -> jsi::Value {
        if (count < 1 || !args[0].isString()) {
          throw jsi::JSError(rt, "open(path: string)");
        }
        auto store = std::make_shared<Store>(args[0].getString(rt).utf8(rt));
        {
          std::lock_guard<std::mutex> lock(g_storesMutex);
          g_stores.push_back(store);
        }
        return jsi::Object::createFromHostObject(rt, store);
      });

  jsi::Object api(rt);
  api.setProperty(rt, "open", std::move(open));
  rt.global().setProperty(rt, "__MyStore", std::move(api));
}

void cleanup() {
  std::lock_guard<std::mutex> lock(g_storesMutex);
  for (auto& weak : g_stores) {
    if (auto s = weak.lock()) s->invalidate();
  }
  g_stores.clear();
}

} // namespace mystore
```

**`src/Store.ts`**

```ts
import NativeStoreModule from '../specs/NativeStore';

export interface Store {
  getString(key: string): string | undefined;
  set(key: string, value: string): void;
  remove(key: string): void;
  getAllKeys(): string[];
  readonly size: number;
  close(): void;
}

declare global {
  var __MyStore: { open(path: string): Store } | undefined;
}

let ready = false;

export function openStore(path: string): Store {
  if (!ready) {
    if (!NativeStoreModule.install()) {
      throw new Error('Failed to install MyStore JSI bindings');
    }
    ready = true;
  }
  const api = global.__MyStore;
  if (!api) throw new Error('MyStore bindings missing');
  return api.open(path);
}
```

**Using it:**

```ts
const store = openStore(`${RNFS.DocumentDirectoryPath}/prefs.db`);

store.set('theme', 'dark');
const theme = store.getString('theme');   // synchronous — no await
console.log(store.size, store.getAllKeys());

// Explicit cleanup — do not rely on the destructor
store.close();
```

**What this example demonstrates:**
- HostObject with a mixed API (methods + a computed `size` property)
- Function caching to avoid per-access allocation
- `shared_from_this()` instead of raw `this` capture
- Thread-safe state with a mutex
- Argument validation with clear `JSError`s
- Probe-key guarding in `get()`
- Idempotent installation
- Explicit `close()` / `invalidate()` rather than destructor-based cleanup
- A destructor that is cheap and touches no runtime

---

## 30. Cheat sheets & checklists

### 30.1 API quick reference

```cpp
// ── Runtime ──
rt.global()                                      // globalThis
rt.evaluateJavaScript(buffer, "url.js")
rt.description()

// ── Value construction ──
jsi::Value::undefined()  /  jsi::Value::null()
jsi::Value(true)  /  jsi::Value(3.14)
jsi::Value(rt, jsiObjectOrString)                // explicit copy
jsi::Value(std::move(jsiObject))                 // move

// ── Value inspection ──
v.isUndefined() isNull() isBool() isNumber() isString() isSymbol()
v.isBigInt() isObject()
v.asNumber() asBool() asString(rt) asObject(rt) asSymbol(rt) asBigInt(rt)  // throws
v.getNumber() getBool() getString(rt) getObject(rt)                        // asserts
v.toString(rt).utf8(rt)                          // like JS String(v)

// ── String ──
jsi::String::createFromAscii(rt, "x")
jsi::String::createFromUtf8(rt, stdString)
str.utf8(rt)
jsi::String::strictEquals(rt, a, b)

// ── PropNameID ──
jsi::PropNameID::forAscii(rt, "x")
jsi::PropNameID::forUtf8(rt, stdString)
jsi::PropNameID::forString(rt, jsiString)
id.utf8(rt)
jsi::PropNameID::compare(rt, a, b)

// ── Object ──
jsi::Object obj(rt);
obj.setProperty(rt, "k", value)
obj.getProperty(rt, "k")
obj.getPropertyAsObject(rt, "k")
obj.getPropertyAsFunction(rt, "k")
obj.hasProperty(rt, "k")
obj.getPropertyNames(rt)                         // → jsi::Array
obj.isArray(rt) isFunction(rt) isArrayBuffer(rt)
obj.asArray(rt) asFunction(rt) getArrayBuffer(rt)
jsi::Object::strictEquals(rt, a, b)

// ── HostObject ──
jsi::Object::createFromHostObject(rt, sharedPtr)
obj.isHostObject<T>(rt)
obj.getHostObject<T>(rt)

// ── NativeState ──
obj.setNativeState(rt, sharedPtr)
obj.hasNativeState<T>(rt)
obj.getNativeState<T>(rt)

// ── Array ──
jsi::Array arr(rt, n);
arr.size(rt)
arr.getValueAtIndex(rt, i)
arr.setValueAtIndex(rt, i, value)

// ── Function ──
jsi::Function::createFromHostFunction(rt, propNameId, arity, lambda)
fn.call(rt, a, b)
fn.call(rt, argsPtr, count)
fn.callWithThis(rt, thisObj, a)
fn.callAsConstructor(rt, a)

// ── ArrayBuffer ──
jsi::ArrayBuffer(rt, sharedPtrToMutableBuffer)   // zero copy
ab.data(rt)   ab.size(rt)

// ── BigInt ──
jsi::BigInt::fromInt64(rt, n)  /  fromUint64(rt, n)
bi.asInt64(rt)  /  getUint64(rt)

// ── Errors ──
throw jsi::JSError(rt, "message");

// ── Threading ──
callInvoker->invokeAsync([](jsi::Runtime& rt) { /* JS thread */ });
callInvoker->invokeSync([]{ /* blocks — careful */ });
```

### 30.2 Rules you must not break

1. Never touch `jsi::Runtime` off the JS thread.
2. Never let a `jsi::*` handle outlive its runtime.
3. Never use a value from runtime A in runtime B.
4. Never read `args[i]` where `i >= count`.
5. Never capture `jsi::Runtime&` in a deferred lambda — use the `rt` parameter.
6. Never do runtime work in a `HostObject` destructor.
7. Never use `get*()` on unvalidated input — use `as*()`.
8. Never let a non-`JSError` C++ exception escape a HostFunction.
9. Never assume `paramCount` constrains the caller.
10. Never allocate in `HostObject::get()` on a hot path without caching.

### 30.3 New-module checklist

**Design**
- [ ] Could this be a plain TurboModule? (If yes, do that.)
- [ ] Fixed API shape → plain Object + HostFunctions, not HostObject.
- [ ] Sync only where the work is genuinely sub-frame.

**Implementation**
- [ ] Every argument validated with a clear error message.
- [ ] `as*()` used on all incoming values.
- [ ] Functions cached (or a fixed-shape Object used).
- [ ] `get()` returns `undefined` for probe keys (`then`, `toJSON`, `@@…`).
- [ ] `getPropertyNames()` implemented.
- [ ] All shared state mutex-protected if reachable from >1 thread.
- [ ] Background work hops back via `CallInvoker`.
- [ ] Plain C++ types (not `jsi::Value`) cross thread boundaries.

**Lifecycle**
- [ ] `install()` is idempotent.
- [ ] `invalidate()` clears every cached `jsi::*` handle.
- [ ] Platform `invalidate` hooks wired on both iOS and Android.
- [ ] Explicit `close()`/`dispose()` exposed to JS.
- [ ] Destructor is cheap and runtime-free.

**Build**
- [ ] `-frtti -fexceptions`, C++20.
- [ ] `.mm` not `.m` on iOS.
- [ ] `System.loadLibrary` name matches the CMake target.
- [ ] Correct `ReactAndroid::` CMake targets for your RN version.
- [ ] All ABIs built.

**Verification**
- [ ] Reload (`r`) 20 times — no crash, no leak.
- [ ] Background/foreground the app repeatedly.
- [ ] Test in a **release** build on a **real device**.
- [ ] Run with ASan and TSan at least once.
- [ ] Test the error paths from JS (wrong types, missing args).

---

## 31. Further reading

**Source (the real documentation)**
- `node_modules/react-native/ReactCommon/jsi/jsi/jsi.h` — read this whole file once. It's ~1400 lines and it's the actual contract.
- `node_modules/react-native/ReactCommon/jsi/jsi/decorator.h` — runtime decorators (tracing, locking).
- `node_modules/react-native/ReactCommon/callinvoker/ReactCommon/CallInvoker.h`
- `node_modules/react-native/ReactCommon/react/nativemodule/core/ReactCommon/TurboModule.h`
- `node_modules/react-native/ReactCommon/react/bridging/` — the type-conversion layer TurboModules use.

**Official docs**
- reactnative.dev — "The New Architecture", "Turbo Native Modules", "Codegen"

**Libraries to read**
- `react-native-mmkv` → `cpp/MmkvHostObject.cpp` (start here, ~250 lines)
- `op-sqlite` → modern CMake + bindings reference
- `react-native-nitro-modules` → what generated JSI looks like
- `react-native-worklets` → secondary runtimes

**Suggested learning path**
1. Read `jsi.h` top to bottom. Skim what you don't follow.
2. Build the Counter HostObject from §10.2. Get it running on one platform.
3. Add a HostFunction that takes a JS callback and calls it synchronously.
4. Make it async with `CallInvoker` (§15.2).
5. Return a Promise (§16.1).
6. Add an ArrayBuffer method (§22).
7. Port it to the second platform.
8. Reload 20 times, fix what breaks.
9. Read MMKV's source and see which of your choices it made differently.

---

*End of guide.*
