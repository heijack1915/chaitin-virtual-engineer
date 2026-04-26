# Chaitin Virtual Engineer（长亭虚拟工程师）

长亭科技产品远程部署与运维工具，通过 SSH 在目标主机上自动化执行安装、卸载、升级等操作，支持 AI 智能引导。

## 支持范围

| 产品 | 状态 |
|------|------|
| **SafeLine WAF（雷池）软件版** | 已支持 — 反代单机/集群、嵌入式单机/集群、流量镜像 |
| 牧云 CloudWalker | 敬请期待 |
| 洞鉴 X-Ray | 敬请期待 |
| 谛听 D-Sensor | 敬请期待 |

## 功能

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

## 技术栈

| 层级 | 技术 |
|------|------|
| 后端 | Go 1.23 + Echo |
| 前端 | HTML + CSS + JavaScript（零框架依赖） |
| 通信 | SSH2 (golang.org/x/crypto) + SFTP + SSE |
| AI | OpenAI 兼容格式（支持任意大模型 API） |

## 快速开始

### 编译

```bash
make build
# 生成 ./chaitin-ve
```

### 运行

```bash
./chaitin-ve
# 或指定端口和数据目录
./chaitin-ve -port 8080 -data ./data
```

启动后浏览器访问 `http://localhost:8080`。

### 配置 AI（可选）

在页面右上角「设置」中配置：

| 配置项 | 说明 |
|--------|------|
| API URL | OpenAI 兼容格式的 API 地址 |
| API Key | 密钥 |
| Model | 模型名称 |

### 导入知识库

1. 准备 ZIP 格式知识库（内含 `manifest.json` + `wiki/` 目录）
2. 在页面「知识库」标签页点击导入

## Windows 一键启动器

为 Windows 用户提供图形化启动体验，无需打开命令行。

### 功能

| 功能 | 说明 |
|------|------|
| 系统托盘图标 | 绿色盾牌 = 运行中，灰色盾牌 = 已停止 |
| 一键启动/停止 | 双击启动器自动启动主程序，托盘菜单可停止 |
| 自动打开浏览器 | 主程序启动后自动打开管理界面 |
| 知识库管理 | 导入 zip / 查看已加载 / 打开知识库目录 |
| 自动重启 | 主程序崩溃后自动重启（最多 3 次） |
| 配置持久化 | 端口、数据目录等配置保存在 `%APPDATA%/chaitin-ve-launcher/config.json` |

### 项目结构

```
chaitin-virtual-engineer-launcher/
├── main.go              # 程序入口
├── tray.go              # 系统托盘菜单和事件处理
├── server.go            # 主程序进程管理（启动/停止/健康检查）
├── knowledge.go         # 知识库导入/列出/删除
├── icon.go              # 纯 Go 生成盾牌图标（绿/灰两色）
├── dialog_windows.go    # Windows 原生对话框（MessageBox + 文件选择）
├── dialog_other.go      # 非 Windows 平台空实现
├── util.go              # 通用工具
├── go.mod / go.sum
└── build.sh             # macOS 交叉编译脚本
```

### 编译

```bash
# macOS / Linux 交叉编译
cd chaitin-virtual-engineer-launcher && ./build.sh
# 生成 chaitin-ve-launcher.exe（约 7MB，单文件无外部依赖）

# Windows 本地编译
go build -ldflags "-s -w" -o chaitin-ve-launcher.exe .
```

### 使用方式

1. 将 `chaitin-ve-launcher.exe` 和 `chaitin-ve.exe` 放在同一目录
2. 双击 `chaitin-ve-launcher.exe`
3. 系统托盘出现盾牌图标，主程序自动启动，浏览器自动打开 `http://localhost:8080`

### 托盘菜单

```
🟢 SafeLine 虚拟工程师 (运行中 :8080)
─────────────────────
  打开管理界面
  知识库管理 ▸
    ├─ 查看已加载
    ├─ 导入知识库...
    └─ 打开知识库目录
─────────────────────
  端口: 8080
─────────────────────
  退出
```

## 目录结构

```
chaitin-virtual-engineer_1.0/
├── main.go                 # 程序入口
├── go.mod / go.sum         # Go 模块依赖
├── Makefile                # 构建脚本
├── README.md               # 项目说明
├── DESIGN.md               # 设计文档
├── core/                   # 核心引擎
│   ├── ssh/client.go       # SSH 连接管理
│   ├── executor/engine.go  # 命令执行器
│   └── knowledge/loader.go # 知识库加载（支持多 .md 文件）
├── models/
│   └── models.go           # 数据模型
├── ui/                     # 前端
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
