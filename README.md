# 长亭虚拟工程师

给长亭工程师远程部署产品用的工具，打开网页就能操作远程主机，不用一个个敲命令。

---

## 怎么用

### Windows 用户（推荐）

1. 下载两个文件：`chaitin-ve.exe` 和 `chaitin-ve-launcher.exe`
2. 把它们放在同一个文件夹里
3. 双击 `chaitin-ve-launcher.exe`
4. 等几秒，浏览器会自动打开，就可以用了
5. 用完了，右键电脑右下角的小盾牌图标 → 点「退出」

> 小盾牌在哪？看屏幕右下角通知栏，可能要点一下「^」箭头才能看到。
> 绿色的 = 程序在运行，灰色的 = 程序没在运行。

**launcher 还能干嘛：**

| 右键小盾牌菜单 | 干啥的 |
|---|---|
| 打开管理界面 | 再打开一次网页 |
| 查看已加载 | 看现在装了哪些知识库 |
| 导入知识库 | 从电脑上选一个 zip 文件导进去 |
| 打开知识库目录 | 打开存放知识库的文件夹 |
| 退出 | 关掉程序 |

### Mac / Linux 用户

打开终端，输入：

```bash
# 给运行权限
chmod +x chaitin-ve
# 启动
./chaitin-ve
```

然后浏览器打开 `http://localhost:8080` 就能用了。

---

## 网页上怎么操作

打开后是一个网页界面，主要功能：

| 功能 | 怎么用 |
|---|---|
| **添加主机** | 点「添加主机」，填 IP、端口、用户名、密码 |
| **安装产品** | 选一台主机 → 上传安装包 → 点安装，自动搞定 |
| **卸载产品** | 选一台主机 → 点卸载，自动清理干净 |
| **升级产品** | 选一台主机 → 点升级，自动执行升级流程 |
| **问 AI** | 右边有个对话框，可以问产品相关的问题 |

---

## 配置 AI（可选）

想用 AI 对话功能的话，点页面右上角「设置」，填三个东西：

| 填什么 | 是什么 | 去哪拿 |
|---|---|---|
| API URL | AI 接口地址 | 问给你接口的人 |
| API Key | 密钥 | 同上 |
| Model | 模型名字 | 同上 |

不配置的话 AI 功能用不了，其他功能正常。

---

## 导入知识库

知识库就是让 AI 懂产品知识用的，不导入 AI 就啥也不知道。

1. 准备好知识库 zip 文件
2. 打开网页 → 点「知识库」标签
3. 点「导入」→ 选择 zip 文件

---

## 技术说明（给开发人员看的）

下面这些是给开发人员看的，普通用户不用管。

### 支持的产品

| 产品 | 状态 |
|------|------|
| **SafeLine WAF（雷池）软件版** | 已支持 — 反代单机/集群、嵌入式单机/集群、流量镜像 |
| 牧云 CloudWalker | 敬请期待 |
| 洞鉴 X-Ray | 敬请期待 |
| 谛听 D-Sensor | 敬请期待 |

### 功能列表

| 功能 | 说明 |
|------|------|
| 主机管理 | 添加/编辑/删除远程主机，SSH 连接测试 |
| 离线安装 | 上传安装包 → SFTP 传输到目标主机（实时进度）→ 自动化安装 |
| 离线卸载 | 自动探测安装路径 → 清理所有组件和残留（含 Docker 网络/卷）→ 验证 |
| 离线升级 | 一键执行 minion setup -m 升级流程 |
| 管理节点部署模式 | 完整部署 / 仅管理（--block-service）/ 仅管理（后期页面配置） |
| AI 智能引导 | 对话式交互，AI 优先基于知识库回答，支持产品问答和操作指导 |
| 知识库热插拔 | 导入 ZIP 格式知识库即可支持新产品，支持多知识库并行 |
| 检测节点证书 | 自动从管理节点获取证书，通过管道输入交互式 minion setup |
| Docker 一键卸载 | 内置 Docker 彻底卸载脚本（8 步清理 + 验证） |
| 终端模拟 | 内置 Web 终端，支持命令执行和输出回显 |

### 技术栈

| 层级 | 技术 |
|------|------|
| 后端 | Go 1.23 + Echo |
| 前端 | HTML + CSS + JavaScript（零框架依赖） |
| 通信 | SSH2 (golang.org/x/crypto) + SFTP + SSE |
| AI | OpenAI 兼容格式（支持任意大模型 API） |

### 编译

```bash
make build
# 生成 ./chaitin-ve
```

### 运行参数

```bash
./chaitin-ve -port 8080 -data ./data
```

| 参数 | 默认值 | 说明 |
|------|--------|------|
| `-port` | 8080 | 网页端口 |
| `-data` | `./data` | 数据存放目录 |

### Windows 启动器编译

```bash
# macOS / Linux 交叉编译到 Windows
cd chaitin-virtual-engineer-launcher && ./build.sh

# Windows 本地编译
go build -ldflags "-s -w" -o chaitin-ve-launcher.exe .
```

### 目录结构

```
chaitin-virtual-engineer/
├── main.go                 # 程序入口
├── go.mod / go.sum         # Go 模块依赖
├── Makefile                # 构建脚本
├── core/                   # 核心引擎
│   ├── ssh/client.go       # SSH 连接管理
│   ├── executor/engine.go  # 命令执行器
│   └── knowledge/loader.go # 知识库加载
├── models/
│   └── models.go           # 数据模型
├── ui/                     # 前端页面
│   ├── index.html
│   ├── app.js
│   └── styles.css
└── scripts/
    └── docker-uninstall.sh # Docker 卸载脚本
```

## 知识库格式

```
knowledge.zip
├── manifest.json    # 名称、版本、描述、supported_operations
├── sources/         # 原始文档（可选）
└── wiki/
    ├── index.md     # 首页内容
    └── *.md         # 其他 Wiki 页面（全部加载供 AI 使用）
```

### manifest.json 示例

```json
{
  "name": "雷池SafeLine知识库",
  "version": "25.03.005",
  "description": "SafeLine WAF 完整知识库",
  "supported_operations": ["install", "uninstall", "upgrade"]
}
```

## 已有知识库

| 知识库 | 版本 | 内容 | 大小 |
|--------|------|------|------|
| safeline-knowledge.zip | 25.03.005 | 软件部署手册 + 集群部署实战经验（含证书处理、卸载清理、故障排查） | 19K |
| safeline-user-operation-guide.zip | SL-20-25.03.004 | 用户操作手册完整内容：统计报表、日志分析、安全管理、系统监控、网络部署、系统设置 | 4.8M |
| safeline-monitoring-snmp-syslog.zip | V1.1 | SNMP OID 完整参考表 + Syslog 所有日志字段定义 + attack_type 枚举（37种攻击类型） | 781K |
| safeline-hardware-deployment-plans.zip | V1.2 | 硬件 WAF 部署方案（透明桥/镜像旁路/透明代理/反向代理），**以硬件为主** | 8.3M |

## SafeLine WAF 支持的部署模式

### 软件部署模式

| 模式 | 参数 | 说明 |
|------|------|------|
| 软件反代单机 | `-t Software` | 最简部署，单机反向代理 |
| 软件反代集群（管理节点） | `-t S20Management` | 集群管理节点，支持完整部署或仅管理（--block-service） |
| 软件反代集群（检测节点） | `-t S20Agent` | 集群检测节点，需 5 步交互式输入 |
| 软件嵌入式单机 | `-t C20Master` | 嵌入式部署，单机模式 |
| 软件嵌入式集群（管理节点） | `-t C20Master` | 嵌入式集群管理节点 |
| 软件嵌入式集群（检测节点） | `-t C20Slave` | 嵌入式集群检测节点 |
| 软件流量镜像 | `-t TrafficMirror` | 旁路镜像模式 |

### 管理节点部署模式选项

| 模式 | 说明 | 生成的命令 |
|------|------|-----------|
| 完整部署 | 管理 + 检测 + 转发（11 个容器） | `minion setup -t S20Management -p /data/safeline` |
| 仅管理（--block-service） | 不含检测/转发服务（约 7 个容器） | `minion setup -t S20Management --block-service detector --block-service mario-collector --block-service tengine` |
| 仅管理（后期页面配置） | 常规部署后通过 6767 端口删除服务 | 常规部署 + 提示用户访问 6767 页面配置 |

### 检测节点交互式输入

检测节点 `minion setup -t S20Agent` 需要输入 5 项信息：

| 步骤 | 输入项 | 来源 |
|------|--------|------|
| 1 | DB Password | 安装时设置的管理员密码 |
| 2 | API Token | 从管理节点 API 获取 |
| 3 | Bot Module | 通常为 `safe-line-bot-module` |
| 4 | Management Address | 管理节点 IP（`https://<管理节点IP>:9443`） |
| 5 | Certificate (PEM) | 管理节点证书（Base64 编码，需管道输入） |

### 证书获取路径

| 节点 | 证书路径 |
|------|---------|
| 管理节点（源） | `/data/safeline/resources/management/certs/minion.crt` |
| 检测节点（目标） | `/data/safeline/resources/minion/certs/management.crt` |

### 卸载清理步骤（8 步）

| 步骤 | 操作 | 说明 |
|------|------|------|
| [1] | 停止 minion 服务 | `systemctl stop minion` |
| [2] | 删除所有容器 | `docker rm -f $(docker ps -a -q)` |
| [3] | 清理 Docker 网络和卷 | `docker network rm safeline` + `docker volume prune -f` |
| [4] | 清理安装目录 | `rm -fr /data/safeline` |
| [5] | 清理 upgrader 残留 | `rm -fr /data/safeline-upgrader` |
| [6] | 清理配置和二进制 | minion 配置文件 + 可执行文件 |
| [7] | 删除安装记录 | `/etc/safeline/.minion_setup` |
| [8] | 验证清理结果 | 检查进程、容器、目录、Docker 网络 |

## 常见故障排查

| 故障 | 原因 | 解决方法 |
|------|------|---------|
| 证书 "bad pem format" | Base64 解码不完整，证书文件被截断 | 从管理节点直接复制 PEM 文件到检测节点 |
| 检测节点未注册 | minion 服务异常退出 | 检查证书文件完整性（`wc -c` 应 > 1000 字节），修复后 `systemctl restart minion` |
| gRPC 连接未建立 | 检测节点未完成交互式注册 | 检查 `/data/safeline/resources/minion/certs/management.crt` 是否正确 |
| Docker 网络残留 | 卸载后 safeline 网络仍存在 | `docker network rm safeline` |
| Docker 匿名卷残留 | 卸载后磁盘空间未释放 | `docker volume prune -f` |
| minion-upgrader 不存在 | 版本 25.03.005 已移除此组件 | 忽略相关错误，属正常现象 |
| 集群部署 6767 端口不通 | 管理节点仅管理模式未启动检测服务 | 使用 --block-service 或通过 6767 页面配置 |

## Syslog 攻击类型枚举（常用）

| 类型值 | 攻击类型 | 类型值 | 攻击类型 |
|--------|---------|--------|---------|
| 0 | SQL 注入 | 10 | 文件上传 |
| 1 | XSS | 11 | 文件包含 |
| 2 | CSRF | 18 | Xpath 注入 |
| 3 | SSRF | 20 | 目录穿越 |
| 5 | 后门 | 21 | 扫描器 |
| 6 | 反序列化 | 29 | 模板注入 (SSTI) |
| 7 | 代码执行 | 34 | 条件竞争 |
| 8 | 代码注入 | 35 | HTTP 协议合规 |
| 9 | 命令注入 | 61 | 超时 |
| 14 | 信息泄露 | 63 | 威胁情报 |

完整枚举（37 种）见 `safeline-monitoring-snmp-syslog.zip` 知识库。

## License

Private - Chaitin Technology
