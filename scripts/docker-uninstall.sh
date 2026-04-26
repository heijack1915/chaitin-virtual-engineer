#!/bin/bash
set -e

# ==================== Docker 一键彻底卸载脚本 ====================
# 功能：彻底卸载Docker及所有相关组件
# 适用：离线安装、apt/yum/dnf安装等所有方式
# 版本：通用版
# ====================

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# 是否删除镜像/容器/数据卷（默认否）
REMOVE_DATA=false

# 解析参数
while [[ $# -gt 0 ]]; do
    case $1 in
        --remove-data|-d)
            REMOVE_DATA=true
            shift
            ;;
        --help|-h)
            echo "用法: $0 [选项]"
            echo ""
            echo "选项:"
            echo "  --remove-data, -d    删除所有镜像、容器、数据卷（危险操作）"
            echo "  --help, -h           显示此帮助信息"
            echo ""
            echo "示例:"
            echo "  $0                    # 仅卸载Docker，保留数据"
            echo "  $0 --remove-data      # 彻底卸载，包含所有数据"
            exit 0
            ;;
        *)
            echo "未知参数: $1"
            echo "使用 --help 查看帮助"
            exit 1
            ;;
    esac
done

echo -e "${BLUE}================================================${NC}"
echo -e "${BLUE}       Docker 一键彻底卸载脚本${NC}"
echo -e "${BLUE}================================================${NC}"
echo ""

# 检查是否以root运行
if [ "$EUID" -ne 0 ]; then
    echo -e "${RED}错误：请使用root权限运行此脚本${NC}"
    echo "命令：sudo $0"
    exit 1
fi

# 保存当前目录
CURRENT_DIR=$(pwd)

# ========================================
# 步骤1: 停止所有Docker服务
# ========================================
echo -e "${YELLOW}[1/10] 停止Docker服务...${NC}"

# 停止docker服务
if systemctl is-active --quiet docker 2>/dev/null; then
    systemctl stop docker 2>/dev/null || true
    echo -e "  ${GREEN}✓${NC} Docker服务已停止"
fi

# 停止docker.socket
if systemctl is-active --quiet docker.socket 2>/dev/null; then
    systemctl stop docker.socket 2>/dev/null || true
    echo -e "  ${GREEN}✓${NC} Docker socket已停止"
fi

# 停止containerd
if systemctl is-active --quiet containerd 2>/dev/null; then
    systemctl stop containerd 2>/dev/null || true
    echo -e "  ${GREEN}✓${NC} Containerd服务已停止"
fi

# ========================================
# 步骤2: 禁用开机自启
# ========================================
echo -e "${YELLOW}[2/10] 禁用开机自启动...${NC}"

systemctl disable docker.socket 2>/dev/null || true
systemctl disable docker 2>/dev/null || true
systemctl disable containerd 2>/dev/null || true
echo -e "  ${GREEN}✓${NC} 已禁用所有自启动项"

# ========================================
# 步骤3: 删除systemd服务文件
# ========================================
echo -e "${YELLOW}[3/10] 删除systemd服务文件...${NC}"

rm -f /etc/systemd/system/docker.service
rm -f /etc/systemd/system/docker.socket
rm -f /etc/systemd/system/containerd.service
rm -f /etc/systemd/system/containerd.socket
rm -f /etc/systemd/system/docker.service.d/  # 清理配置目录

# 重新加载systemd
systemctl daemon-reload
systemctl reset-failed
echo -e "  ${GREEN}✓${NC} systemd服务文件已清理"

# ========================================
# 步骤4: 删除Docker程序文件
# ========================================
echo -e "${YELLOW}[4/10] 删除Docker程序文件...${NC}"

# 删除docker主程序（离线安装位置）
rm -f /usr/local/bin/dockerd
rm -f /usr/local/bin/containerd
rm -f /usr/local/bin/containerd-shim
rm -f /usr/local/bin/containerd-shim-runc-v2
rm -f /usr/local/bin/runc
rm -f /usr/local/bin/docker-init
rm -f /usr/local/bin/docker-proxy

# 删除docker-cli（某些安装方式）
rm -f /usr/bin/dockerd
rm -f /usr/bin/docker
rm -f /usr/local/bin/docker

# 删除docker-compose
rm -f /usr/local/bin/docker-compose
rm -f /usr/local/bin/docker-compose-plugin
rm -f /usr/bin/docker-compose
rm -f /usr/local/lib/docker/cli-plugins/docker-compose
rm -f /usr/lib/docker/cli-plugins/docker-compose

echo -e "  ${GREEN}✓${NC} Docker程序文件已删除"

# ========================================
# 步骤5: 删除Docker数据（可选）
# ========================================
echo -e "${YELLOW}[5/10] 清理Docker数据...${NC}"

if [ "$REMOVE_DATA" = true ]; then
    echo -e "  ${RED}警告：即将删除所有镜像、容器、数据卷！${NC}"
    rm -rf /var/lib/docker 2>/dev/null || true
    rm -rf /var/lib/containerd 2>/dev/null || true
    echo -e "  ${GREEN}✓${NC} 所有Docker数据已删除"
else
    # 清理空的docker目录（保留数据）
    [ -d /var/lib/docker ] && rmdir /var/lib/docker 2>/dev/null || true
    [ -d /var/lib/containerd ] && rmdir /var/lib/containerd 2>/dev/null || true
    echo -e "  ${YELLOW}○${NC} Docker数据已保留（使用 --remove-data 可删除）"
fi

# ========================================
# 步骤6: 删除网络配置
# ========================================
echo -e "${YELLOW}[6/10] 清理网络配置...${NC}"

# 删除docker网络接口
ip link delete docker0 2>/dev/null || true
ip link delete br-* 2>/dev/null || true

# 删除iptables规则
iptables -t nat -F 2>/dev/null || true
iptables -t filter -F DOCKER 2>/dev/null || true
iptables -t nat -F DOCKER 2>/dev/null || true

# 清理ipvs规则
ipvsadm -C 2>/dev/null || true

echo -e "  ${GREEN}✓${NC} 网络配置已清理"

# ========================================
# 步骤7: 清理用户和组
# ========================================
echo -e "${YELLOW}[7/10] 清理Docker用户组...${NC}"

# 删除docker组
groupdel docker 2>/dev/null || true

# 从所有用户组中移除docker
for user in $(getent passwd | cut -d: -f1); do
    usermod -G "" "$user" 2>/dev/null || true
done

echo -e "  ${GREEN}✓${NC} Docker用户组已清理"

# ========================================
# 步骤8: 删除配置文件
# ========================================
echo -e "${YELLOW}[8/10] 删除配置文件...${NC}"

rm -rf /etc/docker 2>/dev/null || true
rm -rf /etc/containerd 2>/dev/null || true
rm -rf /etc/default/docker 2>/dev/null || true
rm -rf /etc/sysconfig/docker 2>/dev/null || true

echo -e "  ${GREEN}✓${NC} 配置文件已删除"

# ========================================
# 步骤9: 清理环境变量
# ========================================
echo -e "${YELLOW}[9/10] 清理环境变量...${NC}"

# 清理profile.d中的docker环境变量
rm -f /etc/profile.d/docker.sh 2>/dev/null || true
rm -f /etc/profile.d/docker-compose.sh 2>/dev/null || true

echo -e "  ${GREEN}✓${NC} 环境变量已清理"

# ========================================
# 步骤10: 清理残留链接
# ========================================
echo -e "${YELLOW}[10/10] 清理残留链接...${NC}"

# 清理可能的软链接
find /usr -type l -name "*docker*" 2>/dev/null | xargs rm -f 2>/dev/null || true
find /usr/local -type l -name "*docker*" 2>/dev/null | xargs rm -f 2>/dev/null || true

echo -e "  ${GREEN}✓${NC} 残留链接已清理"

# ========================================
# 完成
# ========================================
echo ""
echo -e "${GREEN}================================================${NC}"
echo -e "${GREEN}       Docker 彻底卸载完成！${NC}"
echo -e "${GREEN}================================================${NC}"
echo ""
echo -e "已清理内容："
echo -e "  • Docker服务及systemd配置"
echo -e "  • Docker程序文件（/usr/local/bin, /usr/bin）"
echo -e "  • Docker Compose"
echo -e "  • 网络配置"
echo -e "  • 配置文件"
if [ "$REMOVE_DATA" = true ]; then
    echo -e "  • ${RED}所有镜像、容器、数据卷${NC}"
else
    echo -e "  • Docker数据已保留在 /var/lib/docker"
fi
echo ""

# 提示重新登录
echo -e "${YELLOW}提示：如果之前使用非root用户运行docker，${NC}"
echo -e "${YELLOW}      可能需要重新登录终端以清除DOCKER_HOST等环境变量${NC}"
echo ""

# 返回原目录
cd "$CURRENT_DIR"