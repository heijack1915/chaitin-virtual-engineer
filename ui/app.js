(function () {
    'use strict';

    const API = '/api';

    const state = {
        currentTab: 'hosts',
        hosts: [],
        selectedHost: null,
        terminalLines: [],   // plain text lines for AI context
        chatHistory: [],
        hostCwd: {},         // host_id -> current working directory
        packages: [],        // [{name, size}]
        deployedPkgs: JSON.parse(localStorage.getItem('ve_deployed_pkgs') || '[]'),
        mgmtNodes: JSON.parse(localStorage.getItem('ve_mgmt_nodes') || '[]'),
    };

    // ── init ──────────────────────────────────────────────────────────────
    document.addEventListener('DOMContentLoaded', () => {
        bindNav();
        bindModals();
        bindHostForm();
        bindHostOpsModal();
        bindMgmtNodeSelectors();
        bindExecute();
        bindPackages();
        bindKnowledge();
        bindChat();
        bindSettings();
        loadSettings();
        loadHosts();
    });

    // ── navigation ────────────────────────────────────────────────────────
    function bindNav() {
        document.querySelectorAll('.tab').forEach(tab => {
            tab.addEventListener('click', () => {
                const name = tab.dataset.tab;
                document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === name));
                document.querySelectorAll('.tab-content').forEach(s => s.classList.toggle('active', s.id === 'tab-' + name));
                state.currentTab = name;
                if (name === 'knowledge') loadKnowledge();
                if (name === 'packages') loadPackages();
            });
        });
    }

    // ── modals ────────────────────────────────────────────────────────────
    function bindModals() {
        document.querySelectorAll('[data-close-modal]').forEach(btn => {
            btn.addEventListener('click', () => {
                const modal = btn.closest('.modal');
                modal.classList.remove('active');
                // Reset addHostModal title and editId when closed
                if (modal.id === 'addHostModal') {
                    delete modal.dataset.editId;
                    modal.querySelector('.modal-header h3').textContent = '添加主机';
                    document.getElementById('addHostForm').reset();
                }
            });
        });
        document.querySelectorAll('.modal').forEach(m => {
            m.addEventListener('click', e => {
                if (e.target === m) {
                    m.classList.remove('active');
                    if (m.id === 'addHostModal') {
                        delete m.dataset.editId;
                        m.querySelector('.modal-header h3').textContent = '添加主机';
                        document.getElementById('addHostForm').reset();
                    }
                }
            });
        });
        document.getElementById('btnAddHost').addEventListener('click', () =>
            document.getElementById('addHostModal').classList.add('active'));
        document.getElementById('btnSettings').addEventListener('click', () =>
            document.getElementById('settingsModal').classList.add('active'));
    }

    // ── hosts ─────────────────────────────────────────────────────────────
    function loadHosts() {
        fetch(API + '/hosts').then(r => r.json()).then(data => {
            state.hosts = Array.isArray(data) ? data : [];
            renderHosts();
            updateHostSelects();
        }).catch(() => showToast('加载主机失败', 'error'));
    }

    function renderHosts() {
        const el = document.getElementById('hostList');
        if (!state.hosts.length) { el.innerHTML = '<div class="empty-state">暂无主机，点击右上角添加</div>'; return; }
        el.innerHTML = state.hosts.map(h => `
            <div class="host-card">
                <div class="host-card-header">
                    <span class="host-name">${esc(h.name)}</span>
                    <span class="host-status ${h.status === 'online' ? 'online' : 'offline'}">${h.status === 'online' ? '在线' : '离线'}</span>
                </div>
                <div class="host-info">
                    <div>${esc(h.ip)}:${h.port || 22}</div>
                    <div>用户: ${esc(h.username)}</div>
                    <div>安装包密码: ${h.pkg_pass ? '<span class="sudo-ready">已配置</span>' : '<span class="sudo-none">未配置</span>'} &nbsp; Sudo: ${h.sudo_pass ? '<span class="sudo-ready">已配置</span>' : '<span class="sudo-none">未配置</span>'}</div>
                </div>
                <div class="host-actions">
                    <button class="btn btn-secondary" onclick="window._testHost('${h.id}')">测试连接</button>
                    <button class="btn btn-secondary" onclick="window._editHost('${h.id}')">编辑</button>
                    <button class="btn btn-primary" onclick="window._hostOps('${h.id}')">操作</button>
                    <button class="btn btn-danger" onclick="window._deleteHost('${h.id}')">删除</button>
                </div>
            </div>`).join('');
    }

    function updateHostSelects() {
        const opts = '<option value="">-- 选择主机 --</option>' +
            state.hosts.map(h => `<option value="${h.id}">${esc(h.name)} (${esc(h.ip)})</option>`).join('');
        document.getElementById('hostSelect').innerHTML = opts;
        document.getElementById('chatHostSelect').innerHTML = opts.replace('-- 选择主机 --', '-- 选择主机（可选）--');
        document.getElementById('deployHostSelect').innerHTML = opts;
    }

    function bindHostForm() {
        document.getElementById('addHostForm').addEventListener('submit', e => {
            e.preventDefault();
            const fd = new FormData(e.target);
            const body = {
                name: fd.get('name'), ip: fd.get('ip'),
                port: parseInt(fd.get('port')) || 22,
                username: fd.get('username'),
                password: fd.get('password'),
                private_key: fd.get('private_key'),
                pkg_pass: fd.get('pkg_pass'),
                sudo_pass: fd.get('sudo_pass'),
            };
            const modal = document.getElementById('addHostModal');
            const editId = modal.dataset.editId;
            const url = editId ? API + '/hosts/' + editId : API + '/hosts';
            const method = editId ? 'PUT' : 'POST';
            fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
                .then(r => r.json()).then(d => {
                    if (d.error) { showToast(d.error, 'error'); return; }
                    showToast(editId ? '主机已更新' : '主机已添加', 'success');
                    e.target.reset();
                    delete modal.dataset.editId;
                    modal.querySelector('.modal-header h3').textContent = '添加主机';
                    modal.classList.remove('active');
                    loadHosts();
                }).catch(() => showToast(editId ? '更新失败' : '添加失败', 'error'));
        });
    }

    window._testHost = function (id) {
        fetch(API + '/hosts/' + id + '/test', { method: 'POST' })
            .then(r => r.json()).then(d => {
                showToast(d.status === 'ok' ? '连接成功' : ('连接失败: ' + d.message), d.status === 'ok' ? 'success' : 'error');
                loadHosts();
            });
    };
    window._deleteHost = function (id) {
        if (!confirm('确定删除该主机？')) return;
        fetch(API + '/hosts/' + id, { method: 'DELETE' }).then(() => { showToast('已删除', 'success'); loadHosts(); });
    };
    window._editHost = function (id) {
        const h = state.hosts.find(h => h.id === id);
        if (!h) return;
        const modal = document.getElementById('addHostModal');
        const form = document.getElementById('addHostForm');
        // Fill form with existing values
        form.querySelector('[name=name]').value = h.name || '';
        form.querySelector('[name=ip]').value = h.ip || '';
        form.querySelector('[name=port]').value = h.port || 22;
        form.querySelector('[name=username]').value = h.username || '';
        form.querySelector('[name=password]').value = '';   // never pre-fill ssh password
        form.querySelector('[name=private_key]').value = '';
        form.querySelector('[name=pkg_pass]').value = '';    // show empty; only sent if user types something
        form.querySelector('[name=sudo_pass]').value = '';
        modal.querySelector('.modal-header h3').textContent = '编辑主机';
        modal.dataset.editId = id;
        modal.classList.add('active');
    };

    window._hostOps = function (hostId) {
        const host = state.hosts.find(h => h.id === hostId);
        if (!host) return;
        const modal = document.getElementById('hostOpsModal');
        modal.dataset.hostId = hostId;
        document.getElementById('hostOpsTitle').textContent = '操作主机: ' + host.name;

        // 填充已上传安装包列表，优先标注已传到本机的包
        const pkgSel = document.getElementById('opsPkgSelect');
        const deployedOnHost = state.deployedPkgs.filter(d => d.hostId === hostId);
        pkgSel.innerHTML = '<option value="">-- 选择已上传的安装包 --</option>' +
            state.packages.map(p => {
                const dep = deployedOnHost.find(d => d.pkgName === p.name);
                const label = dep
                    ? `${esc(p.name)} ✓ 已在主机 ${esc(dep.remotePath)}`
                    : `${esc(p.name)} (${fmtBytes(p.size)})`;
                return `<option value="${esc(p.name)}" data-remote="${dep ? esc(dep.remotePath) : ''}">${label}</option>`;
            }).join('');

        // 自动预选该主机上最近部署的包
        if (deployedOnHost.length > 0) {
            const latest = deployedOnHost[deployedOnHost.length - 1];
            pkgSel.value = latest.pkgName;
        }

        // 默认显示安装选项
        document.querySelector('input[name="opsType"][value="install"]').checked = true;
        document.getElementById('opsInstallOpts').style.display = 'block';
        document.getElementById('opsUpgradeOpts').style.display = 'none';
        document.getElementById('opsUninstallOpts').style.display = 'none';

        modal.classList.add('active');
    };

    function bindHostOpsModal() {
        // 操作类型切换
        document.querySelectorAll('input[name="opsType"]').forEach(r => {
            r.addEventListener('change', () => {
                document.getElementById('opsInstallOpts').style.display  = r.value === 'install'   ? 'block' : 'none';
                document.getElementById('opsUpgradeOpts').style.display  = r.value === 'upgrade'   ? 'block' : 'none';
                document.getElementById('opsUninstallOpts').style.display = r.value === 'uninstall' ? 'block' : 'none';
                document.getElementById('btnConfirmOps').className = r.value === 'uninstall'
                    ? 'btn btn-danger' : 'btn btn-primary';
                document.getElementById('btnConfirmOps').textContent = r.value === 'uninstall'
                    ? '确认卸载 !' : '执行 →';
            });
        });

        // 安装模式切换：检测节点/管理节点显示对应选项
        document.querySelectorAll('input[name="opsDeplMode"]').forEach(r => {
            r.addEventListener('change', () => {
                const agentModes = ['s20_agent', 'c20_slave'];
                const mgmtModes = ['s20_management', 'c20_master'];
                document.getElementById('opsAgentOpts').style.display =
                    agentModes.includes(r.value) ? 'block' : 'none';
                document.getElementById('opsMgmtOpts').style.display =
                    mgmtModes.includes(r.value) ? 'block' : 'none';
            });
        });

        // 卸载 Docker 勾选时显示子选项
        document.getElementById('opsUninstallDocker').addEventListener('change', function() {
            document.getElementById('opsDockerDataOpts').style.display = this.checked ? 'block' : 'none';
        });

        // 安装包下拉选中后同步到手填路径（提示用）
        document.getElementById('opsPkgSelect').addEventListener('change', function() {
            if (this.value) document.getElementById('opsPkgPath').value = '';
        });

        document.getElementById('btnConfirmOps').addEventListener('click', () => {
            const modal  = document.getElementById('hostOpsModal');
            const hostId = modal.dataset.hostId;
            const opsType = document.querySelector('input[name="opsType"]:checked').value;

            if (opsType === 'install') {
                const pkgFromSel  = document.getElementById('opsPkgSelect').value;
                const pkgFromPath = document.getElementById('opsPkgPath').value.trim();
                if (!pkgFromSel && !pkgFromPath) { showToast('请选择安装包或填写路径', 'error'); return; }

                const pkgName = pkgFromSel || pkgFromPath.split('/').pop();

                const mode = document.querySelector('input[name="opsDeplMode"]:checked').value;
                const modeOpts = {
                    mode,
                    installDir: document.getElementById('opsInstallDir').value.trim() || '/data/safeline',
                    managementAddr: document.getElementById('opsManagementAddr').value.trim(),
                };
                // 管理节点服务范围
                const mgmtModes = ['s20_management', 'c20_master'];
                if (mgmtModes.includes(mode)) {
                    const flavorEl = document.querySelector('input[name="opsMgmtFlavor"]:checked');
                    modeOpts.mgmtFlavor = flavorEl ? flavorEl.value : 'full';
                }
                const installMethod = document.querySelector('input[name="opsInstallMethod"]:checked').value;
                modal.classList.remove('active');

                // 优先用手填路径；其次查 deployedPkgs；都没有则在目标主机上 find 出来
                let knownPath = pkgFromPath;
                if (!knownPath && pkgFromSel) {
                    const dep = state.deployedPkgs.filter(d => d.hostId === hostId && d.pkgName === pkgFromSel);
                    if (dep.length > 0) knownPath = dep[dep.length - 1].remotePath;
                }

                const doInstall = (remotePath) => {
                    if (installMethod === 'ai') {
                        switchToAIChat(hostId, pkgName, remotePath, mode, modeOpts);
                    } else {
                        startOfflineInstall(hostId, pkgName, remotePath, mode, modeOpts);
                    }
                };

                if (knownPath) {
                    doInstall(knownPath);
                } else {
                    // 路径未知，先在目标主机上 find 找到文件再继续
                    document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === 'execute'));
                    document.querySelectorAll('.tab-content').forEach(s => s.classList.toggle('active', s.id === 'tab-execute'));
                    document.getElementById('hostSelect').value = hostId;
                    state.currentTab = 'execute';
                    appendTerminal('=== 在目标主机上查找安装包: ' + pkgName + ' ===', 'system');
                    fetch(API + '/execute', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ host_id: hostId, command: 'find / -name ' + JSON.stringify(pkgName) + ' -type f 2>/dev/null | head -5' }),
                    })
                    .then(r => r.json())
                    .then(d => {
                        if (d.error) { appendTerminal('查找失败: ' + d.error, 'error'); return; }
                        let foundPath = '';
                        streamJobThen(d.job_id, hostId, () => {
                            if (!foundPath) {
                                appendTerminal('未在目标主机上找到安装包，请手动填写路径', 'error');
                                return;
                            }
                            // 记录找到的路径
                            state.deployedPkgs.push({ pkgName, hostId, remotePath: foundPath, time: new Date().toLocaleTimeString() });
                            localStorage.setItem('ve_deployed_pkgs', JSON.stringify(state.deployedPkgs));
                            appendTerminal('找到安装包: ' + foundPath, 'system');
                            doInstall(foundPath);
                        }, (line) => {
                            // 第一行非空就是路径
                            if (!foundPath && line.trim().startsWith('/')) foundPath = line.trim();
                        });
                    });
                }

            } else if (opsType === 'upgrade') {
                const installDir = document.getElementById('opsUpgradeInstallDir').value.trim() || '/data/safeline';
                modal.classList.remove('active');
                runUpgrade(hostId, installDir);

            } else if (opsType === 'uninstall') {
                const installDir = document.getElementById('opsUninstallDir').value.trim() || '/data/safeline';
                const uninstallDocker = document.getElementById('opsUninstallDocker').checked;
                const removeDockerData = document.getElementById('opsRemoveDockerData').checked;
                // 拿到选中的安装包信息，用于精准搜索残留
                const pkgFromSel = document.getElementById('opsPkgSelect').value;
                const pkgFromPath = document.getElementById('opsPkgPath').value.trim();
                let pkgName = pkgFromSel || (pkgFromPath ? pkgFromPath.split('/').pop() : '');
                let pkgRemotePath = pkgFromPath;
                if (!pkgRemotePath && pkgFromSel) {
                    const dep = state.deployedPkgs.filter(d => d.hostId === hostId && d.pkgName === pkgFromSel);
                    if (dep.length) pkgRemotePath = dep[dep.length - 1].remotePath;
                }
                modal.classList.remove('active');
                runUninstall(hostId, installDir, uninstallDocker, removeDockerData, pkgName, pkgRemotePath);
            }
        });
    }

    function runUpgrade(hostId, installDir) {
        document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === 'execute'));
        document.querySelectorAll('.tab-content').forEach(s => s.classList.toggle('active', s.id === 'tab-execute'));
        document.getElementById('hostSelect').value = hostId;
        state.currentTab = 'execute';
        appendTerminal('=== 开始升级 WAF ===', 'system');

        const cmds = [
            { label: '[1] 执行 minion setup -m',    cmd: 'minion setup -m' },
            { label: '[2] 重启 minion 服务',         cmd: 'systemctl restart minion' },
            { label: '[3] 等待服务启动',              cmd: 'sleep 15' },
            { label: '[3] 验证容器状态',              cmd: 'docker ps -a' },
        ];
        runCommandsSequentially(hostId, cmds, 0);
    }

    // SafeLine 卸载的核心函数
    // 三段式：1) 安装时记录的 install-info → 2) 用户填写的路径 → 3) 从雷池自身机制探测
    function runUninstall(hostId, installDir, uninstallDocker, removeDockerData, pkgName, pkgRemotePath) {
        document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === 'execute'));
        document.querySelectorAll('.tab-content').forEach(s => s.classList.toggle('active', s.id === 'tab-execute'));
        document.getElementById('hostSelect').value = hostId;
        state.currentTab = 'execute';
        appendTerminal('=== 开始卸载 WAF ===', 'system');

        // 判断是否需要探测安装路径
        const userFilledDir = document.getElementById('opsUninstallDir').value.trim();
        const needDiscover = !userFilledDir; // 用户没填才需要探测

        if (needDiscover) {
            appendTerminal('--- 探测安装路径 ---', 'system');

            // 三级探测：install-info → systemd → 默认标准路径
            const discoverCmd = [
                'R=""',
                'if [ -f /root/.safeline-install-info ]; then R=$(grep "^INSTALL_DIR:" /root/.safeline-install-info | cut -d: -f2); fi',
                'if [ -z "$R" ] && [ -f /etc/systemd/system/minion.service ]; then R=$(grep -oP "(?<=WorkingDirectory=)\\S+" /etc/systemd/system/minion.service 2>/dev/null); fi',
                'if [ -z "$R" ] && [ -d /data/safeline ]; then R="/data/safeline"; fi',
                'echo "__FOUND__:${R}"',
            ].join('\n');

            fetch(API + '/execute', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ host_id: hostId, command: discoverCmd }),
            })
            .then(r => r.json())
            .then(d => {
                if (d.error) { appendTerminal('探测失败: ' + d.error, 'error'); return; }
                let discoveredDir = '';
                streamJobThen(d.job_id, hostId, () => {
                    if (discoveredDir) {
                        appendTerminal('发现安装目录: ' + discoveredDir, 'system');
                        doUninstall(hostId, discoveredDir, uninstallDocker, removeDockerData);
                    } else {
                        appendTerminal('未找到安装目录，请手动填写安装目录后重试', 'system');
                    }
                }, (line) => {
                    const m = line.trim().match(/^__FOUND__:(.*)$/);
                    if (m && m[1]) discoveredDir = m[1];
                });
            });
        } else {
            doUninstall(hostId, installDir, uninstallDocker, removeDockerData);
        }
    }

    // 实际执行卸载：安装目录 + 固定路径
    function doUninstall(hostId, installDir, uninstallDocker, removeDockerData) {
        if (installDir) appendTerminal('安装目录: ' + installDir, 'system');

        const cmds = [
            { label: '[1] 停止 minion 服务', cmd: 'systemctl stop minion 2>&1', failOk: true },
            { label: '[2] 删除所有容器', cmd: 'docker rm -f $(docker ps -a -q) 2>&1 || true', failOk: true },
            { label: '[3] 清理 Docker 网络和卷', cmd: 'docker network rm safeline 2>/dev/null; docker volume prune -f 2>/dev/null; echo "[OK]"', failOk: true },
            { label: '[4] 清理安装目录', cmd: 'rm -fr ' + installDir + ' 2>&1 && echo "[OK]" || echo "[FAIL]"' },
            { label: '[5] 清理 upgrader（旧版本残留）', cmd: 'systemctl stop minion-upgrader 2>/dev/null; systemctl disable minion-upgrader 2>/dev/null; rm -rf /data/safeline-upgrader 2>/dev/null; rm -f /etc/systemd/system/minion-upgrader.service 2>/dev/null; echo "[OK]"', failOk: true },
            { label: '[6] 清理配置和二进制', cmd: 'rm -rf /etc/minion 2>/dev/null && rm -f /usr/sbin/minion /usr/sbin/minion.* 2>/dev/null && rm -f /etc/systemd/system/minion.service 2>/dev/null && systemctl daemon-reload 2>/dev/null && systemctl reset-failed 2>/dev/null; echo "[OK]"', failOk: true },
            { label: '[7] 删除安装记录', cmd: 'rm -f /root/.safeline-install-info 2>/dev/null; echo "[OK]"', failOk: true },
            { label: '[8] 验证清理结果', cmd: 'echo "=== 验证固定路径 ==="; [ -d /etc/minion ] && echo "[残留] /etc/minion" || echo "[干净] /etc/minion"; [ -f /usr/sbin/minion ] && echo "[残留] /usr/sbin/minion" || echo "[干净] /usr/sbin/minion"; [ -f /etc/systemd/system/minion.service ] && echo "[残留] minion.service" || echo "[干净] minion.service"; [ -d ' + installDir + ' ] && echo "[残留] ' + installDir + '" || echo "[干净] ' + installDir + '"; echo "=== 完成 ==="', failOk: true },
        ];

        if (uninstallDocker) {
            appendTerminal('=== 继续卸载 Docker ===', 'system');
            cmds.push(
                { label: '[D1] 停止 Docker', cmd: 'systemctl stop docker; systemctl stop docker.socket; systemctl stop containerd', failOk: true },
                { label: '[D2] 禁用自启', cmd: 'systemctl disable docker.socket; systemctl disable docker; systemctl disable containerd', failOk: true },
                { label: '[D3] 删除服务文件', cmd: 'rm -f /etc/systemd/system/docker.service /etc/systemd/system/docker.socket /etc/systemd/system/containerd.service /etc/systemd/system/containerd.socket && systemctl daemon-reload && systemctl reset-failed', failOk: true },
                { label: '[D4] 删除程序', cmd: 'rm -f /usr/local/bin/dockerd /usr/local/bin/containerd /usr/local/bin/containerd-shim /usr/local/bin/containerd-shim-runc-v2 /usr/local/bin/runc /usr/local/bin/docker-init /usr/local/bin/docker-proxy /usr/bin/dockerd /usr/bin/docker /usr/local/bin/docker /usr/local/bin/docker-compose /usr/local/bin/docker-compose-plugin /usr/bin/docker-compose /usr/local/lib/docker/cli-plugins/docker-compose /usr/lib/docker/cli-plugins/docker-compose', failOk: true },
                { label: '[D5] 清理数据', cmd: removeDockerData ? 'rm -rf /var/lib/docker /var/lib/containerd' : 'echo "Docker 数据已保留"', failOk: true },
                { label: '[D6] 清理网络', cmd: 'ip link delete docker0 2>/dev/null; ip link delete br-* 2>/dev/null; iptables -t nat -F 2>/dev/null; iptables -t filter -F DOCKER 2>/dev/null; iptables -t nat -F DOCKER 2>/dev/null; echo "[OK]"', failOk: true },
                { label: '[D7] 清理用户组', cmd: 'groupdel docker 2>/dev/null; echo "[OK]"', failOk: true },
                { label: '[D8] 清理配置', cmd: 'rm -rf /etc/docker /etc/containerd /etc/default/docker /etc/sysconfig/docker /etc/profile.d/docker.sh /etc/profile.d/docker-compose.sh; echo "[OK]"', failOk: true },
                { label: '[D9] 清理软链接', cmd: 'find /usr -type l -name "*docker*" -delete 2>/dev/null; find /usr/local -type l -name "*docker*" -delete 2>/dev/null; echo "[OK]"', failOk: true }
            );
        }

        runCommandsSequentially(hostId, cmds, 0);
    }

    function bindMgmtNodeSelectors() {
        function onMgmtSelect(e) {
            const idx = e.target.value;
            const mgmtNodes = state.mgmtNodes || [];
            const addrInput = e.target.closest('.mode-opts, #opsAgentOpts')
                ? e.target.closest('.mode-opts, #opsAgentOpts').querySelector('input[type="text"]')
                : null;
            const hint = e.target.closest('.mode-opts')
                ? e.target.closest('.mode-opts').querySelector('.form-hint')
                : null;
            if (idx !== '' && mgmtNodes[idx]) {
                const m = mgmtNodes[idx];
                if (addrInput) addrInput.value = m.addr;
                if (hint) {
                    hint.style.display = 'block';
                    hint.textContent = 'Token: ' + m.token.substring(0, 16) + '... | BotModule: ' + (m.botModule || '未获取') + ' | Cert: ' + (m.cert ? '已获取' : '未获取');
                }
            } else {
                if (addrInput) addrInput.value = '';
                if (hint) hint.style.display = 'none';
            }
        }
        const s1 = document.getElementById('opt-mgmt-node-select');
        const s2 = document.getElementById('ops-mgmt-node-select');
        if (s1) s1.addEventListener('change', onMgmtSelect);
        if (s2) s2.addEventListener('change', onMgmtSelect);
        // 打开 deploy modal 时刷新下拉框
        document.getElementById('btnDeploy')?.addEventListener('click', populateMgmtNodeSelects);
        document.getElementById('btnHostOps')?.addEventListener('click', populateMgmtNodeSelects);
    }

    // ── execute (SSE streaming) ───────────────────────────────────────────
    function bindExecute() {
        document.getElementById('btnExecute').addEventListener('click', doExecute);
        document.getElementById('commandInput').addEventListener('keydown', e => {
            if (e.key === 'Enter') doExecute();
        });
        document.getElementById('hostSelect').addEventListener('change', () => {
            const hostId = document.getElementById('hostSelect').value;
            const cwd = state.hostCwd[hostId] || '~';
            document.querySelector('.prompt').textContent = cwd + ' $';
        });
        document.getElementById('btnClearTerminal').addEventListener('click', () => {
            document.getElementById('terminalOutput').innerHTML = '';
            state.terminalLines = [];
        });
    }

    function doExecute() {
        const hostId = document.getElementById('hostSelect').value;
        const cmd = document.getElementById('commandInput').value.trim();
        if (!hostId) { showToast('请先选择主机', 'error'); return; }
        if (!cmd) return;

        appendTerminal('$ ' + cmd, 'command');
        document.getElementById('commandInput').value = '';

        // Wrap command with cwd tracking: cd to saved dir first, run command,
        // then print a sentinel with the new pwd so we can update cwd state.
        const cwd = state.hostCwd[hostId] || '';
        const cdPrefix = cwd ? 'cd ' + JSON.stringify(cwd) + ' 2>/dev/null && ' : '';
        const wrapped = cdPrefix + cmd + '; __ec=$?; echo "__CWD__:$(pwd)"; exit $__ec';

        fetch(API + '/execute', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ host_id: hostId, command: wrapped }),
        }).then(r => r.json()).then(d => {
            if (d.error) { appendTerminal('错误: ' + d.error, 'error'); return; }
            streamJob(d.job_id, hostId);
        }).catch(err => appendTerminal('请求失败: ' + err.message, 'error'));
    }

    function streamJob(jobId, hostId) {
        const es = new EventSource(API + '/execute/stream?job_id=' + jobId);
        es.onmessage = e => {
            const d = JSON.parse(e.data);
            if (d.done) { es.close(); return; }
            if (d.line !== undefined) {
                if (d.line.startsWith('__CWD__:')) {
                    if (hostId) state.hostCwd[hostId] = d.line.slice(8);
                    return;
                }
                let cls = 'output', text = d.line;
                if (d.line.startsWith('\x00stderr\x00')) { cls = 'error'; text = d.line.slice(8); }
                else if (d.line.startsWith('[ERROR]') || d.line.startsWith('[EXIT ')) { cls = 'error'; }
                appendTerminal(text, cls);
            }
        };
        es.onerror = () => { appendTerminal('[连接中断]', 'system'); es.close(); };
    }

    function appendTerminal(text, cls) {
        cls = cls || 'output';
        const out = document.getElementById('terminalOutput');
        const line = document.createElement('div');
        line.className = 'terminal-line terminal-' + cls;
        line.textContent = text;
        out.appendChild(line);
        out.scrollTop = out.scrollHeight;
        state.terminalLines.push(text);
        if (state.terminalLines.length > 200) state.terminalLines.shift();
        updateChatContextHint();
        // Update prompt to show current cwd
        const hostId = document.getElementById('hostSelect').value;
        const cwd = state.hostCwd[hostId] || '~';
        document.querySelector('.prompt').textContent = cwd + ' $';
    }

    // ── packages ──────────────────────────────────────────────────────────
    function bindPackages() {
        document.getElementById('btnUploadPkg').addEventListener('click', () =>
            document.getElementById('pkgFileInput').click());
        document.getElementById('pkgFileInput').addEventListener('change', e => {
            const file = e.target.files[0];
            if (!file) return;
            uploadPackageWithProgress(file);
            e.target.value = '';
        });

        // Mode card switching — show agent/mgmt options for relevant modes
        document.querySelectorAll('input[name="deployMode"]').forEach(radio => {
            radio.addEventListener('change', () => {
                const agentModes = ['s20_agent', 'c20_slave'];
                const mgmtModes = ['s20_management', 'c20_master'];
                document.getElementById('modeOpts-agent').style.display =
                    agentModes.includes(radio.value) ? 'block' : 'none';
                document.getElementById('modeOpts-mgmt').style.display =
                    mgmtModes.includes(radio.value) ? 'block' : 'none';
            });
        });

        document.getElementById('btnConfirmDeploy').addEventListener('click', () => {
            const pkgName    = document.getElementById('deployPkgName').value;
            const hostId     = document.getElementById('deployHostSelect').value;
            const remotePath = document.getElementById('deployRemotePath').value.trim();
            if (!hostId) { showToast('请选择目标主机', 'error'); return; }

            const mode          = document.querySelector('input[name="deployMode"]:checked').value;
            const modeOpts      = collectModeOpts(mode);
            const installMethod = document.querySelector('input[name="installMethod"]:checked').value;

            document.getElementById('deployModal').classList.remove('active');

            const floating = document.getElementById('uploadFloating');
            const fill     = document.getElementById('uploadFloatingFill');
            const pct      = document.getElementById('uploadFloatingPct');
            const sub      = document.getElementById('uploadFloatingSub');
            document.getElementById('uploadFloatingName').textContent = '传输到主机: ' + pkgName;
            fill.classList.remove('indeterminate');
            fill.style.transition = 'width 0.3s ease';
            fill.style.width = '0%';
            pct.textContent  = '0%';
            sub.textContent  = '通过 SFTP 传输中...';
            floating.style.display = 'block';

            const url = API + '/packages/' + encodeURIComponent(pkgName) + '/deploy'
                + '?host_id=' + encodeURIComponent(hostId)
                + '&remote_path=' + encodeURIComponent(remotePath);
            const es = new EventSource(url);

            es.onmessage = ev => {
                let d;
                try { d = JSON.parse(ev.data); } catch(_) { return; }

                if (d.error) {
                    es.close();
                    floating.style.display = 'none';
                    showToast('传输失败: ' + d.error, 'error');
                    return;
                }

                if (d.bytes !== undefined && d.total) {
                    const p = Math.min(d.pct, 100);
                    fill.style.width = p + '%';
                    pct.textContent  = p + '%';
                    const mb = (d.bytes / 1048576).toFixed(1);
                    const tot = (d.total / 1048576).toFixed(1);
                    sub.textContent  = mb + ' MB / ' + tot + ' MB';
                }

                if (d.done) {
                    es.close();
                    fill.style.width = '100%';
                    pct.textContent  = '100%';
                    setTimeout(() => { floating.style.display = 'none'; }, 800);

                    const host = state.hosts.find(h => h.id === hostId);
                    state.deployedPkgs.push({
                        pkgName, hostId,
                        hostName: host ? host.name : hostId,
                        remotePath: d.remote_path,
                        time: new Date().toLocaleTimeString(),
                    });
                    localStorage.setItem('ve_deployed_pkgs', JSON.stringify(state.deployedPkgs));
                    showToast('传输完成，开始安装...', 'success');

                    if (installMethod === 'ai') {
                        switchToAIChat(hostId, pkgName, d.remote_path, mode, modeOpts);
                    } else {
                        startOfflineInstall(hostId, pkgName, d.remote_path, mode, modeOpts);
                    }
                }
            };

            es.onerror = () => {
                es.close();
                floating.style.display = 'none';
                showToast('传输失败', 'error');
            };
        });
    }

    function uploadPackageWithProgress(file) {
        const floating = document.getElementById('uploadFloating');
        const fill     = document.getElementById('uploadFloatingFill');
        const pct      = document.getElementById('uploadFloatingPct');
        const sub      = document.getElementById('uploadFloatingSub');
        document.getElementById('uploadFloatingName').textContent = file.name;
        fill.style.width = '0%';
        pct.textContent  = '0%';
        sub.textContent  = '准备上传...';
        floating.style.display = 'block';

        const fd = new FormData();
        fd.append('file', file);
        const xhr = new XMLHttpRequest();
        xhr.open('POST', API + '/packages/upload');
        xhr.upload.onprogress = ev => {
            if (ev.lengthComputable) {
                const p = Math.round(ev.loaded / ev.total * 100);
                fill.style.width = p + '%';
                pct.textContent  = p + '%';
                sub.textContent  = fmtBytes(ev.loaded) + ' / ' + fmtBytes(ev.total);
            }
        };
        xhr.onload = () => {
            try {
                const d = JSON.parse(xhr.responseText);
                if (d.error) { showToast('上传失败: ' + d.error, 'error'); floating.style.display = 'none'; return; }
            } catch(_) {}
            fill.style.width = '100%';
            pct.textContent  = '100%';
            sub.textContent  = '上传完成！';
            setTimeout(() => { floating.style.display = 'none'; }, 2000);
            showToast('安装包上传成功', 'success');
            loadPackages();
        };
        xhr.onerror = () => { showToast('上传失败', 'error'); floating.style.display = 'none'; };
        xhr.send(fd);
    }

    function startOfflineInstall(hostId, pkgName, remotePath, mode, modeOpts) {
        document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === 'execute'));
        document.querySelectorAll('.tab-content').forEach(s => s.classList.toggle('active', s.id === 'tab-execute'));
        document.getElementById('hostSelect').value = hostId;
        state.currentTab = 'execute';

        appendTerminal('=== 开始离线安装 ' + pkgName + ' [' + mode + '] ===', 'system');

        // 从 state 里拿当前主机的 pkg_pass（API 返回的）
        const host = state.hosts.find(h => h.id === hostId);
        let pkgPass = host ? (host.pkg_pass || '') : '';

        const proceed = (pass) => {
            const cmds = buildInstallCommands(pkgName, remotePath, modeOpts, pass);
            const isMgmt = ['s20_management', 'c20_master'].includes(modeOpts.mode);
            runCommandsSequentially(hostId, cmds, 0, isMgmt ? () => extractMgmtCredentials(hostId) : null);
        };

        if (!pkgPass) {
            const pass = window.prompt('请输入安装包密码（留空则不带 -p 参数）：', '');
            if (pass === null) { appendTerminal('已取消安装', 'system'); return; }
            pkgPass = pass.trim();
            if (pkgPass && host) {
                // 保存密码到主机配置，下次不再询问
                host.pkg_pass = pkgPass;
                fetch(API + '/hosts/' + hostId, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ pkg_pass: pkgPass }),
                });
            }
        }

        proceed(pkgPass);
    }

    function extractMgmtCredentials(hostId) {
        const host = state.hosts.find(h => h.id === hostId);
        const hostLabel = host ? host.name + ' (' + host.ip + ')' : hostId;
        appendTerminal('--- 提取管理节点凭据 ---', 'system');

        const extractCmd = [
            'MYIP=$(hostname -I | awk \'{print $1}\')',
            'MADDR=$(minion db get /minion/v1/services/management_addr 2>/dev/null | sed "s|127\\.0\\.0\\.1|$MYIP|" || echo "")',
            'MTOKEN=$(minion db get /minion/v1/services/minion_api_token 2>/dev/null || echo "")',
            'MPASS=$(minion db get /minion/v1/services/postgres_password 2>/dev/null || echo "")',
            'MBOTJS=$(minion db get /minion/v1/bot_js_location 2>/dev/null || echo "")',
            'MCERT=$(cat /data/safeline/resources/management/certs/minion.crt 2>/dev/null | base64 -w 0 || echo "")',
            'echo "__MGMTCRED__"',
            'echo "ADDR:$MADDR"',
            'echo "TOKEN:$MTOKEN"',
            'echo "PASS:$MPASS"',
            'echo "BOTJS:$MBOTJS"',
            'echo "CERT:$MCERT"',
            'echo "__MGMTCRED_END__"',
        ].join('\n');

        fetch(API + '/execute', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ host_id: hostId, command: extractCmd }),
        }).then(r => r.json()).then(d => {
            if (d.error) { appendTerminal('提取凭据失败: ' + d.error, 'error'); return; }
            const cred = { hostId, hostName: hostLabel, addr: '', token: '', pass: '', botModule: '', cert: '', time: new Date().toLocaleString() };
            streamJobThen(d.job_id, hostId, () => {
                if (cred.addr && cred.token) {
                    state.mgmtNodes = state.mgmtNodes.filter(m => m.hostId !== hostId);
                    state.mgmtNodes.push(cred);
                    localStorage.setItem('ve_mgmt_nodes', JSON.stringify(state.mgmtNodes));
                    appendTerminal('管理节点凭据已保存（' + cred.addr + '）', 'system');
                    appendTerminal('Token: ' + cred.token.substring(0, 16) + '...', 'system');
                    appendTerminal('BotModule: ' + (cred.botModule || '未获取'), 'system');
                    appendTerminal('Cert: ' + (cred.cert ? '已获取(base64)' : '未获取'), 'system');
                } else {
                    appendTerminal('凭据提取不完整，请确认管理节点服务已正常启动', 'error');
                }
            }, (line) => {
                if (line.startsWith('ADDR:')) cred.addr = line.slice(5);
                if (line.startsWith('TOKEN:')) cred.token = line.slice(6);
                if (line.startsWith('PASS:')) cred.pass = line.slice(5);
                if (line.startsWith('BOTJS:')) cred.botModule = line.slice(6);
                if (line.startsWith('CERT:')) cred.cert = line.slice(5);
            });
        }).catch(err => appendTerminal('提取凭据失败: ' + err.message, 'error'));
    }

    function buildInstallCommands(pkgName, remotePath, modeOpts, pkgPass) {
        const installDir = modeOpts.installDir || '/data/safeline';

        const minionType = {
            software:       'Software',
            s20_management: 'S20Management',
            s20_agent:      'S20Agent',
            c20_master:     'C20Master',
            c20_slave:      'C20Slave',
            traffic_mirror: 'TrafficMirror',
        }[modeOpts.mode] || 'Software';

        const isAgent = ['s20_agent', 'c20_slave'].includes(modeOpts.mode);

        const cmds = [];

        // Step 1: 环境检查
        cmds.push({ label: '[1] 检查 CPU 指令集', cmd: 'lscpu | grep -E "ssse3|avx2"', failOk: true });
        cmds.push({ label: '[1] 检查内存和磁盘', cmd: 'free -h && df -h ' + installDir.split('/').slice(0,2).join('/'), failOk: true });

        // Step 2: 创建安装目录
        cmds.push({ label: '[2] 创建安装目录', cmd: 'mkdir -p ' + installDir });

        // Step 3: 准备安装包（不移动，直接在标准路径内执行解压，安装包解压内容落到 CWD）
        cmds.push({ label: '[3] 准备安装包', cmd: 'chmod +x ' + remotePath });
        const runInstaller = pkgPass
            ? 'yes "" | ' + remotePath + ' -p ' + pkgPass
            : 'yes "" | ' + remotePath;
        cmds.push({ label: '[4] 在标准路径内执行解压（' + installDir + '）', cmd: 'cd ' + installDir + ' && ' + runInstaller });

        // Step 5: minion setup 初始化部署模式
        if (isAgent) {
            const mgmtAddr = modeOpts.managementAddr || '';
            const mgmtToken = modeOpts.mgmtToken || '';
            const mgmtPass = modeOpts.mgmtPass || '';
            const mgmtBotModule = modeOpts.mgmtBotModule || '';
            const mgmtCert = modeOpts.mgmtCert || '';
            if (mgmtToken && mgmtPass) {
                const setupCmd = 'minion setup -p ' + installDir + ' -t ' + minionType;
                const textInput = mgmtPass + '\n' + mgmtToken + '\n' + mgmtBotModule + '\n' + mgmtAddr + '\n';
                if (mgmtCert) {
                    // 证书必须先写入临时文件再 cat 管道传入，不能嵌入 printf
                    // 因为 base64 -d 输出的 PEM 含换行和特殊字符，在 printf 参数中会被截断
                    cmds.push({
                        label: '[5a] 解码证书到临时文件',
                        cmd: 'echo "' + mgmtCert + '" | base64 -d > /tmp/minion_mgmt_cert.pem && head -1 /tmp/minion_mgmt_cert.pem',
                    });
                    cmds.push({
                        label: '[5b] 初始化部署模式（检测节点-自动）',
                        cmd: '{ printf ' + JSON.stringify(textInput) + '; cat /tmp/minion_mgmt_cert.pem; echo; } | ' + setupCmd,
                    });
                } else {
                    cmds.push({
                        label: '[5] 初始化部署模式（检测节点-自动，无证书）',
                        cmd: 'printf ' + JSON.stringify(textInput + '\n') + ' | ' + setupCmd,
                    });
                }
            } else {
                // 无凭据：提示手动执行
                cmds.push({
                    label: '[5] 初始化部署模式（检测节点）',
                    cmd: 'echo "请在终端手动执行：minion setup -p ' + installDir + ' -t ' + minionType + '" && echo "管理节点地址填写：' + mgmtAddr + '"',
                    failOk: true
                });
            }
        } else {
            const isMgmt = ['s20_management', 'c20_master'].includes(modeOpts.mode);
            const flavor = modeOpts.mgmtFlavor || 'full';
            let setupCmd = 'minion setup -p ' + installDir + ' -t ' + minionType;
            if (isMgmt && flavor === 'block-service') {
                setupCmd += ' --block-service detector --block-service mario-collector --block-service tengine';
            }
            cmds.push({ label: '[5] 初始化部署模式', cmd: setupCmd });
            if (isMgmt && flavor === 'web-config') {
                cmds.push({
                    label: '[5b] 提示：通过 6767 页面删除检测/转发服务',
                    cmd: 'echo "=== 后续配置 ===" && echo "部署完成后，访问 http://$(hostname -I | awk \'{print $1}\'):6767" && echo "选择「编辑本机部署」→「方案配置方式」→ 删除「流量检测服务」「流量转发服务」「日志采集服务」→「点击部署」→「完成」" && echo "=================="',
                    failOk: true
                });
            }
        }

        // Step 6: 启动服务
        if (!isAgent) {
            cmds.push({ label: '[6] 启动 minion 服务', cmd: 'systemctl start minion' });
            cmds.push({ label: '[6] 等待服务启动', cmd: 'sleep 15 && docker ps -a' });
            cmds.push({ label: '[6] 检查服务状态', cmd: 'systemctl status minion --no-pager' });
            cmds.push({
                label: '[6] 获取访问地址',
                cmd: 'echo "管理界面：https://$(hostname -I | awk \'{print $1}\'):9443"',
                failOk: true
            });
        } else {
            cmds.push({ label: '[6] 启动 minion 服务', cmd: 'systemctl start minion' });
            cmds.push({ label: '[6] 等待服务启动', cmd: 'sleep 15 && docker ps -a' });
        }

        // 记录实际安装目录（卸载时读取，用于清理安装目录及其中解压的内容）
        cmds.push({
            label: '[7] 记录安装目录',
            cmd: 'echo "INSTALL_DIR:' + installDir + '" > /root/.safeline-install-info && echo "已记录: ' + installDir,
            failOk: true
        });

        return cmds;
    }

    // 逐条执行命令，每条执行完检查退出码，failOk=true 时失败继续，否则失败停止
    function runCommandsSequentially(hostId, cmds, idx, onAllDone) {
        if (idx >= cmds.length) {
            appendTerminal('=== 所有步骤执行完毕 ===', 'system');
            if (onAllDone) onAllDone();
            return;
        }
        const { label, cmd, failOk } = cmds[idx];
        appendTerminal('--- ' + label + ' ---', 'system');

        const cwd = state.hostCwd[hostId] || '';
        const cdPrefix = cwd ? 'cd ' + JSON.stringify(cwd) + ' 2>/dev/null && ' : '';
        // 用 __EC__ sentinel 传递退出码，避免 CWD sentinel 混淆
        const wrapped = cdPrefix + '(' + cmd + '); __ec=$?; echo "__CWD__:$(pwd)"; echo "__EC__:$__ec"; exit $__ec';

        fetch(API + '/execute', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ host_id: hostId, command: wrapped }),
        }).then(r => r.json()).then(d => {
            if (d.error) { appendTerminal('错误: ' + d.error, 'error'); return; }
            streamJobThen(d.job_id, hostId, (exitCode) => {
                if (exitCode !== 0 && !failOk) {
                    appendTerminal('=== 步骤失败（退出码 ' + exitCode + '），终止安装 ===', 'error');
                    return;
                }
                runCommandsSequentially(hostId, cmds, idx + 1);
            });
        }).catch(err => appendTerminal('请求失败: ' + err.message, 'error'));
    }

    function streamJobThen(jobId, hostId, onDone, onLine) {
        const es = new EventSource(API + '/execute/stream?job_id=' + jobId);
        let exitCode = 0;
        es.onmessage = e => {
            const d = JSON.parse(e.data);
            if (d.done) { es.close(); if (onDone) onDone(exitCode); return; }
            if (d.line !== undefined) {
                if (d.line.startsWith('__CWD__:')) { if (hostId) state.hostCwd[hostId] = d.line.slice(8); return; }
                if (d.line.startsWith('__EC__:')) { exitCode = parseInt(d.line.slice(7)) || 0; return; }
                let cls = 'output', text = d.line;
                if (d.line.startsWith('\x00stderr\x00')) { cls = 'error'; text = d.line.slice(8); }
                else if (d.line.startsWith('[ERROR]') || d.line.startsWith('[EXIT ')) cls = 'error';
                if (onLine) onLine(text);
                appendTerminal(text, cls);
            }
        };
        es.onerror = () => { appendTerminal('[连接中断]', 'system'); es.close(); if (onDone) onDone(-1); };
    }

    function populateMgmtNodeSelects() {
        const mgmtNodes = state.mgmtNodes || [];
        const options = '<option value="">-- 手动填写 --</option>' +
            mgmtNodes.map((m, i) => `<option value="${i}">${esc(m.hostName)} — ${esc(m.addr)}（${m.time}）</option>`).join('');
        ['opt-mgmt-node-select', 'ops-mgmt-node-select'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.innerHTML = options;
        });
    }

    function collectModeOpts(mode) {
        const installDir = (document.getElementById('opt-install-dir').value.trim()) || '/data/safeline';
        const opts = { mode, installDir };
        const agentModes = ['s20_agent', 'c20_slave'];
        const mgmtModes = ['s20_management', 'c20_master'];
        if (agentModes.includes(mode)) {
            opts.managementAddr = document.getElementById('opt-management-addr').value.trim();
            // 附带管理节点凭据
            const selIdx = document.getElementById('opt-mgmt-node-select').value;
            if (selIdx !== '' && state.mgmtNodes[selIdx]) {
                const mgmt = state.mgmtNodes[selIdx];
                opts.mgmtToken = mgmt.token;
                opts.mgmtPass = mgmt.pass;
                opts.mgmtBotModule = mgmt.botModule;
                opts.mgmtCert = mgmt.cert;
            }
        }
        if (mgmtModes.includes(mode)) {
            const flavorEl = document.querySelector('input[name="mgmtFlavor"]:checked');
            opts.mgmtFlavor = flavorEl ? flavorEl.value : 'full';
        }
        return opts;
    }

    function switchToAIChat(hostId, pkgName, remotePath, mode, modeOpts) {
        // Switch tab
        document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === 'chat'));
        document.querySelectorAll('.tab-content').forEach(s => s.classList.toggle('active', s.id === 'tab-chat'));
        state.currentTab = 'chat';
        // Set host in chat
        const chatHostSelect = document.getElementById('chatHostSelect');
        if (hostId) { chatHostSelect.value = hostId; updateChatContextHint(); }
        // Build install task message
        const modeNames = {
            software:       '软件反代单机',
            s20_management: '反代集群-管理节点',
            s20_agent:      '反代集群-检测节点',
            c20_master:     '嵌入式单机/集群管理节点',
            c20_slave:      '嵌入式集群-检测节点',
            traffic_mirror: '软件流量镜像',
        };
        let task = `请帮我在远程主机上安装雷池 WAF。\n\n安装包已上传到：${remotePath}\n部署模式：${modeNames[mode] || mode}`;
        if (modeOpts.installDir)      task += `\n安装目录：${modeOpts.installDir}`;
        if (modeOpts.managementAddr)  task += `\n管理节点地址：${modeOpts.managementAddr}`;
        if (modeOpts.mgmtFlavor) {
            const flavorDesc = { 'full': '完整部署（含检测/转发）', 'block-service': '仅管理（不含检测/转发，使用 --block-service）', 'web-config': '仅管理（部署后通过 6767 页面删除检测/转发服务）' };
            task += `\n管理节点服务范围：${flavorDesc[modeOpts.mgmtFlavor] || modeOpts.mgmtFlavor}`;
        }
        task += `\n\n请按步骤执行安装，遇到密码提示会自动处理，安装完成后告诉我访问地址。`;
        // Pass message directly to avoid textarea timing issues
        sendChatMsg(task);
    }

    function loadPackages() {
        fetch(API + '/packages').then(r => r.json()).then(pkgs => {
            state.packages = pkgs || [];
            const el = document.getElementById('pkgList');
            if (!pkgs.length) { el.innerHTML = '<div class="empty-state">暂无安装包</div>'; return; }
            el.innerHTML = pkgs.map(p => `
                <div class="pkg-card">
                    <div class="pkg-name">${esc(p.name)}</div>
                    <div class="pkg-meta">${fmtBytes(p.size)}</div>
                    <div class="pkg-actions">
                        <button class="btn btn-primary" onclick="window._deployPkg('${esc(p.name)}')">部署到主机</button>
                        <button class="btn btn-danger" onclick="window._deletePkg('${esc(p.name)}')">删除</button>
                    </div>
                </div>`).join('');
        });
    }

    window._deployPkg = function (name) {
        document.getElementById('deployPkgName').value = name;
        document.getElementById('deployRemotePath').value = '/tmp/' + name;
        document.getElementById('deployModal').classList.add('active');
    };
    window._deletePkg = function (name) {
        if (!confirm('确定删除 ' + name + '？')) return;
        fetch(API + '/packages/' + encodeURIComponent(name), { method: 'DELETE' })
            .then(() => { showToast('已删除', 'success'); loadPackages(); });
    };

    // ── knowledge ─────────────────────────────────────────────────────────
    function bindKnowledge() {
        document.getElementById('btnImportKB').addEventListener('click', () =>
            document.getElementById('kbFileInput').click());
        document.getElementById('kbFileInput').addEventListener('change', e => {
            const file = e.target.files[0];
            if (!file) return;
            const fd = new FormData();
            fd.append('file', file);
            fetch(API + '/knowledge/import', { method: 'POST', body: fd })
                .then(r => r.json()).then(d => {
                    if (d.error) { showToast(d.error, 'error'); return; }
                    showToast('知识库导入成功', 'success');
                    loadKnowledge();
                });
            e.target.value = '';
        });
        document.getElementById('btnRefreshKB').addEventListener('click', loadKnowledge);
    }

    function loadKnowledge() {
        fetch(API + '/knowledge').then(r => r.json()).then(kbs => {
            const el = document.getElementById('kbList');
            if (!kbs.length) { el.innerHTML = '<div class="empty-state">暂无知识库，点击右上角导入</div>'; return; }
            el.innerHTML = kbs.map(kb => `
                <div class="kb-card">
                    <div class="kb-name">${esc(kb.name)}</div>
                    <div class="kb-meta">v${esc(kb.version || '?')} · ${esc(kb.description || '')}</div>
                    <div class="kb-actions">
                        <button class="btn btn-secondary" onclick="window._viewKB('${kb.id}')">查看 Wiki</button>
                        <button class="btn btn-danger" onclick="window._deleteKB('${kb.id}')">删除</button>
                    </div>
                </div>`).join('');
        });
    }

    window._viewKB = function (id) {
        fetch(API + '/knowledge/' + id + '/wiki').then(r => r.json()).then(d => {
            const m = document.createElement('div');
            m.className = 'modal active';
            m.innerHTML = `<div class="modal-content" style="max-width:700px">
                <div class="modal-header"><h3>${esc(d.title)}</h3><button class="btn-close" onclick="this.closest('.modal').remove()">&times;</button></div>
                <div class="modal-body"><pre class="wiki-content">${esc(d.content)}</pre></div>
            </div>`;
            document.body.appendChild(m);
            m.addEventListener('click', e => { if (e.target === m) m.remove(); });
        });
    };
    window._deleteKB = function (id) {
        if (!confirm('确定删除该知识库？')) return;
        fetch(API + '/knowledge/' + id, { method: 'DELETE' })
            .then(() => { showToast('已删除', 'success'); loadKnowledge(); });
    };

    // ── AI chat ───────────────────────────────────────────────────────────
    function bindChat() {
        document.getElementById('btnSendChat').addEventListener('click', sendChat);
        document.getElementById('chatInput').addEventListener('keydown', e => {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChat(); }
        });
        document.getElementById('chatHostSelect').addEventListener('change', updateChatContextHint);
    }

    function updateChatContextHint() {
        const hostId = document.getElementById('chatHostSelect').value;
        const lines = state.terminalLines.length;
        const host = state.hosts.find(h => h.id === hostId);
        let hint = '';
        if (host) hint += `主机: ${host.name}`;
        if (lines > 0) hint += (hint ? ' · ' : '') + `终端历史: ${lines} 行`;
        document.getElementById('chatContextHint').textContent = hint ? ('上下文: ' + hint) : '';
    }

    function sendChat() {
        const msg = document.getElementById('chatInput').value.trim();
        if (!msg) return;
        document.getElementById('chatInput').value = '';
        sendChatMsg(msg);
    }

    // Track consecutive follow-up messages for auto-expand KB
    state.chatFollowUpCount = 0;

    function sendChatMsg(msg) {
        if (!msg) return;
        appendChat(msg, 'user');

        const settings = JSON.parse(localStorage.getItem('cve_settings') || '{}');
        const hostId = document.getElementById('chatHostSelect').value;

        if (!settings.apiUrl || !settings.apiKey) {
            appendChat('请先在右上角"设置"中配置 AI 接口（API URL 和 API Key）', 'assistant');
            return;
        }

        // Detect if this is a follow-up question
        const followUpKeywords = ['不对', '不是', '不对吧', '不准确', '找不到', '没找到', '再查查', '详细点', '还有呢', '更多信息'];
        const isFollowUp = followUpKeywords.some(k => msg.includes(k));
        if (isFollowUp) {
            state.chatFollowUpCount++;
        } else {
            state.chatFollowUpCount = 0;
        }
        const expandKB = state.chatFollowUpCount >= 2;

        // Show "thinking" indicator
        const thinkingId = 'thinking-' + Date.now();
        appendChatThinking(thinkingId);

        const turns = [];

        fetch(API + '/chat', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-API-URL': settings.apiUrl || '',
                'X-API-Key': settings.apiKey || '',
                'X-Model': settings.model || '',
            },
            body: JSON.stringify({
                message: msg,
                hostId,
                terminalLines: state.terminalLines,
                history: state.chatHistory,
                deployedPkgs: state.deployedPkgs,
                expandKB: expandKB || undefined,
            }),
        }).then(resp => {
            if (!resp.ok) throw new Error('HTTP ' + resp.status);
            const reader = resp.body.getReader();
            const decoder = new TextDecoder();
            let buffer = '';
            let finalResponse = '';

            function readChunk() {
                return reader.read().then(({ done, value }) => {
                    if (done) {
                        processBuffer();
                        removeThinking(thinkingId);
                        if (!finalResponse && turns.length > 0) {
                            finalResponse = '（执行完成）';
                        }
                        if (finalResponse) {
                            state.chatHistory.push({ role: 'user', content: msg });
                            state.chatHistory.push({ role: 'assistant', content: finalResponse });
                            if (state.chatHistory.length > 40) state.chatHistory = state.chatHistory.slice(-40);
                        }
                        return;
                    }
                    buffer += decoder.decode(value, { stream: true });
                    processBuffer();
                    return readChunk();
                });
            }

            function processBuffer() {
                const lines = buffer.split('\n');
                buffer = lines.pop() || '';
                for (const line of lines) {
                    if (!line.startsWith('data: ')) continue;
                    try {
                        const data = JSON.parse(line.slice(6));
                        if (data.type === 'turn') {
                            removeThinking(thinkingId);
                            turns.push(data);
                            if (data.role === 'assistant') {
                                const execMatch = data.content.match(/\[EXEC:\s*([^\]]+)\]/);
                                if (execMatch) {
                                    appendChatExec(execMatch[1].trim());
                                }
                            } else if (data.role === 'tool_result') {
                                appendChatExecResult(data.content);
                            }
                            // Show thinking again for next AI call
                            appendChatThinking(thinkingId);
                        } else if (data.type === 'response') {
                            removeThinking(thinkingId);
                            finalResponse = data.content;
                            appendChat(data.content, 'assistant');
                        } else if (data.type === 'error') {
                            removeThinking(thinkingId);
                            appendChat('错误: ' + data.content, 'assistant');
                        }
                    } catch (e) { /* skip malformed line */ }
                }
            }

            return readChunk();
        }).catch(err => { removeThinking(thinkingId); appendChat('请求失败: ' + err.message, 'assistant'); });
    }

    function appendChatThinking(id) {
        const el = document.getElementById('chatMessages');
        const div = document.createElement('div');
        div.className = 'message message-bot';
        div.id = id;
        div.innerHTML = `<div class="message-avatar">AI</div><div class="message-content thinking">AI 正在思考并执行中...</div>`;
        el.appendChild(div);
        el.scrollTop = el.scrollHeight;
    }

    function removeThinking(id) {
        const el = document.getElementById(id);
        if (el) el.remove();
    }

    function appendChatExec(cmd) {
        const el = document.getElementById('chatMessages');
        const div = document.createElement('div');
        div.className = 'message message-bot';
        div.innerHTML = `<div class="message-avatar">AI</div>
            <div class="message-content exec-action">
                <span class="exec-label">执行命令</span>
                <code class="exec-cmd">${esc(cmd)}</code>
            </div>`;
        el.appendChild(div);
        el.scrollTop = el.scrollHeight;
    }

    function appendChatExecResult(content) {
        const el = document.getElementById('chatMessages');
        const div = document.createElement('div');
        div.className = 'message message-bot';
        div.innerHTML = `<div class="message-avatar" style="background:#334155">⚙</div>
            <div class="message-content exec-result"><pre>${esc(content)}</pre></div>`;
        el.appendChild(div);
        el.scrollTop = el.scrollHeight;
    }

    function appendChat(text, type) {
        const el = document.getElementById('chatMessages');
        const div = document.createElement('div');
        div.className = 'message message-' + (type === 'user' ? 'user' : 'bot');
        div.innerHTML = `<div class="message-avatar">${type === 'user' ? 'U' : 'AI'}</div>
            <div class="message-content">${renderChatText(text)}</div>`;
        el.appendChild(div);
        el.scrollTop = el.scrollHeight;
    }

    // Render AI text: newlines to <br>, [COMMAND: xxx] becomes a clickable button
    function renderChatText(text) {
        const escaped = esc(text).replace(/\n/g, '<br>');
        return escaped.replace(/\[COMMAND:\s*([^\]]+)\]/g, (_, cmd) => {
            const safeCmd = cmd.trim();
            return `<span class="cmd-suggestion">${esc(safeCmd)}<button class="btn-run-cmd" onclick="window._runSuggestedCmd(${JSON.stringify(safeCmd)})">▶ 执行</button></span>`;
        });
    }

    window._runSuggestedCmd = function (cmd) {
        const hostId = document.getElementById('chatHostSelect').value || document.getElementById('hostSelect').value;
        if (!hostId) { showToast('请先在终端或对话框中选择主机', 'error'); return; }
        // Switch to execute tab and run
        document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === 'execute'));
        document.querySelectorAll('.tab-content').forEach(s => s.classList.toggle('active', s.id === 'tab-execute'));
        document.getElementById('hostSelect').value = hostId;
        document.getElementById('commandInput').value = cmd;
        doExecute();
    };

    // ── settings ──────────────────────────────────────────────────────────
    function bindSettings() {
        // Preset buttons
        document.querySelectorAll('.preset-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const url = btn.dataset.url;
                const model = btn.dataset.model;
                document.getElementById('apiUrl').value = url || '';
                document.getElementById('modelName').value = model || '';
                if (!url && !model) {
                    document.getElementById('apiKey').value = '';
                }
                document.querySelectorAll('.preset-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
            });
        });

        document.getElementById('settingsForm').addEventListener('submit', e => {
            e.preventDefault();
            const fd = new FormData(e.target);
            localStorage.setItem('cve_settings', JSON.stringify({
                apiUrl: fd.get('apiUrl'), apiKey: fd.get('apiKey'), model: fd.get('model'),
            }));
            showToast('设置已保存', 'success');
            document.getElementById('settingsModal').classList.remove('active');
        });
    }

    function loadSettings() {
        const s = JSON.parse(localStorage.getItem('cve_settings') || '{}');
        document.getElementById('apiUrl').value = s.apiUrl || '';
        document.getElementById('apiKey').value = s.apiKey || '';
        document.getElementById('modelName').value = s.model || '';
        // Highlight active preset
        document.querySelectorAll('.preset-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.url === s.apiUrl);
        });
    }

    // ── utilities ─────────────────────────────────────────────────────────
    function esc(t) {
        if (!t) return '';
        const d = document.createElement('div');
        d.textContent = String(t);
        return d.innerHTML;
    }

    function fmtBytes(n) {
        if (!n) return '0 B';
        if (n < 1024) return n + ' B';
        if (n < 1048576) return (n / 1024).toFixed(1) + ' KB';
        return (n / 1048576).toFixed(1) + ' MB';
    }

    function showToast(msg, type) {
        const t = document.createElement('div');
        t.className = 'toast toast-' + (type || 'info');
        t.textContent = msg;
        document.body.appendChild(t);
        setTimeout(() => t.classList.add('show'), 10);
        setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 300); }, 3000);
    }
})();
