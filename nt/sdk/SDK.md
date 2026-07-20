# WebNT SDK 文档 v2.01

## 概述
WebNT SDK 为第三方开发者提供标准接口，用于开发 WebNT 应用。

## 快速开始
```javascript
// 注册应用
WebNT.registerApp({
  id: 'myapp',
  name: '我的应用',
  icon: '🚀',
  color: '#667eea',
  launch() {
    // 创建窗口
    const winId = WebNT.window.create({
      title: '我的应用',
      width: 600,
      height: 400,
      appId: 'myapp',
      icon: '🚀'
    });
    // 渲染 UI
    const el = document.getElementById('myapp');
    if(el) el.innerHTML = '<h1>Hello WebNT!</h1>';
  }
});
```

## API 参考

### WebNT.window
- `create(options)` - 创建窗口
- `destroy(id)` - 销毁窗口
- `focus(id)` - 聚焦窗口
- `bringToFront(id)` - 置顶窗口
- `getList()` - 获取窗口列表
- `on(event, callback)` - 监听窗口事件

### WebNT.syscall
- `call(name, ...args)` - 调用系统调用
- `getSystemInfo()` - 获取系统信息
- `shutdown()` - 关机
- `reboot()` - 重启

### WebNT.storage
- `get(key)` - 读取存储
- `set(key, value)` - 写入存储
- `remove(key)` - 删除存储

### WebNT.desktop
- `addIcon(id, name, icon, color, appId)` - 添加桌面图标
- `setWallpaper(url)` - 设置壁纸

### WebNT.notify(title, body)
- 发送系统通知

### WebNT.registerApp(app)
- 注册应用，app 对象格式: { id, name, icon, color, launch }