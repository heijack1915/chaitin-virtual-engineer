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
        bindThreatIntel();
        loadSettings();
        loadHosts();
        loadPackages(); // BUGFIX: was never called in init, packages list was always empty
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

    // ── Product definitions ─────────────────────────────────────────────
    const PRODUCTS = [
        { id: 'safeline', name: '雷池', desc: 'SafeLine WAF', hasManagement: true, hasDeploy: true },
        { id: 'cloudwalker', name: '牧云', desc: 'CloudWalker HIDS', hasManagement: true, hasDeploy: true },
        { id: 'd-sensor', name: '谛听', desc: 'D-Sensor', hasManagement: false, hasDeploy: false },
        { id: 'x-ray', name: '洞鉴', desc: 'X-Ray', hasManagement: false, hasDeploy: false },
        { id: 'jupiter', name: '全悉', desc: 'Jupiter', hasManagement: false, hasDeploy: false },
    ];

    let _opsHostId = '';
    let _opsProduct = null;
    let _opsAction = '';
    let _tiCurrentThreat = null;

    window._hostOps = function (hostId) {
        const host = state.hosts.find(h => h.id === hostId);
        if (!host) return;
        const modal = document.getElementById('hostOpsModal');
        modal.dataset.hostId = hostId;
        _opsHostId = hostId;
        _opsProduct = null;
        _opsAction = '';
        document.getElementById('hostOpsTitle').textContent = '选择产品 — ' + host.name;
        document.getElementById('opsProductSelect').style.display = 'block';
        document.getElementById('opsProductPanel').style.display = 'none';
        document.getElementById('opsProductDropdown').value = '';
        modal.classList.add('active');
    };

    function selectProduct(pid) {
        const prod = PRODUCTS.find(p => p.id === pid);
        if (!prod) return;
        _opsProduct = prod;
        _opsAction = '';
        document.getElementById('opsProductSelect').style.display = 'none';
        document.getElementById('opsProductPanel').style.display = 'block';
        document.getElementById('opsProductName').textContent = prod.name + ' (' + prod.desc + ')';
        document.getElementById('hostOpsTitle').textContent = prod.name + ' — ' + (state.hosts.find(h => h.id === _opsHostId)?.name || '');

        // Build action buttons
        const bar = document.getElementById('opsActionBar');
        if (!prod.hasDeploy && !prod.hasManagement) {
            bar.innerHTML = '';
        } else {
            let btns = '';
            if (prod.hasDeploy) btns += '<button class="btn btn-primary ops-action-btn" data-action="install">部署</button>';
            if (prod.hasDeploy) btns += '<button class="btn btn-secondary ops-action-btn" data-action="upgrade">升级</button>';
            if (prod.hasDeploy) btns += '<button class="btn btn-danger ops-action-btn" data-action="uninstall">卸载</button>';
            if (prod.hasManagement) btns += '<button class="btn btn-secondary ops-action-btn" data-action="manage">管理配置</button>';
            bar.innerHTML = btns;
            bar.querySelectorAll('.ops-action-btn').forEach(b => {
                b.addEventListener('click', () => {
                    _opsAction = b.dataset.action;
                    bar.querySelectorAll('.ops-action-btn').forEach(x => x.classList.remove('btn-active'));
                    b.classList.add('btn-active');
                    renderOpsActionContent();
                });
            });
        }
        renderOpsActionContent();
    }

    function bindHostOpsModal() {
        // Product dropdown
        document.getElementById('opsProductDropdown').addEventListener('change', function() {
            if (this.value) selectProduct(this.value);
        });

        // Back to product select
        document.getElementById('opsBackToProducts').addEventListener('click', () => {
            document.getElementById('opsProductSelect').style.display = 'block';
            document.getElementById('opsProductPanel').style.display = 'none';
            document.getElementById('opsProductDropdown').value = '';
            document.getElementById('hostOpsTitle').textContent = '选择产品 — ' + (state.hosts.find(h => h.id === _opsHostId)?.name || '');
            _opsProduct = null;
            _opsAction = '';
        });
    }

    function renderOpsActionContent() {
        const el = document.getElementById('opsActionContent');
        if (!_opsProduct) { el.innerHTML = ''; return; }

        // Coming soon for unsupported products
        if (!_opsProduct.hasDeploy && !_opsProduct.hasManagement) {
            el.innerHTML = '<div class="ops-coming-soon"><div class="ops-coming-icon">🚧</div><h3>' + esc(_opsProduct.name) + ' 支持正在开发中，敬请期待！</h3><p>目前可通过 AI 对话获取该产品的相关帮助。</p></div>';
            return;
        }

        if (!_opsAction) {
            el.innerHTML = '<div class="empty-state">请选择上方的操作按钮</div>';
            return;
        }

        const hostId = _opsHostId;

        if (_opsAction === 'install') {
            renderInstallPanel(el, hostId);
        } else if (_opsAction === 'upgrade') {
            renderUpgradePanel(el, hostId);
        } else if (_opsAction === 'uninstall') {
            renderUninstallPanel(el, hostId);
        } else if (_opsAction === 'manage') {
            renderManagePanel(el, hostId);
        }
    }

    // ── Install panel ──
    function renderInstallPanel(el, hostId) {
        const deployedOnHost = state.deployedPkgs.filter(d => d.hostId === hostId);
        const pkgOptions = '<option value="">-- 选择已上传的安装包 --</option>' +
            state.packages.map(p => {
                const dep = deployedOnHost.find(d => d.pkgName === p.name);
                const label = dep ? `${esc(p.name)} ✓ 已在主机 ${esc(dep.remotePath)}` : `${esc(p.name)} (${fmtBytes(p.size)})`;
                return `<option value="${esc(p.name)}" data-remote="${dep ? esc(dep.remotePath) : ''}">${label}</option>`;
            }).join('');

        const isSafeline = _opsProduct.id === 'safeline';
        const installDir = isSafeline ? '/data/safeline' : '/data/cloudwalker';

        el.innerHTML = `
        <div class="form-group">
            <label>安装包</label>
            <select id="opsPkgSelect" class="select" style="width:100%">${pkgOptions}</select>
            <div style="margin-top:8px">
                <label style="font-size:0.82rem;color:var(--text-muted)">或手动填写主机上的路径：</label>
                <input type="text" id="opsPkgPath" placeholder="/tmp/installer.bin" style="margin-top:4px;width:100%">
            </div>
        </div>
        ${isSafeline ? renderSafelineDeployModes('ops') : ''}
        <div class="form-group">
            <label>安装目录</label>
            <input type="text" id="opsInstallDir" placeholder="${installDir}" style="width:100%">
        </div>
        <div class="form-group">
            <label>安装方式</label>
            <div class="deploy-mode-group" style="flex-direction:row;gap:8px">
                <label class="mode-card" style="flex:1">
                    <input type="radio" name="opsInstallMethod" value="kb" checked>
                    <div class="mode-card-body"><div class="mode-title">离线（知识库）</div><div class="mode-desc">无需网络，命令回显到终端</div></div>
                </label>
                <label class="mode-card" style="flex:1">
                    <input type="radio" name="opsInstallMethod" value="ai">
                    <div class="mode-card-body"><div class="mode-title">AI 辅助</div><div class="mode-desc">AI 分析执行，支持排错</div></div>
                </label>
            </div>
        </div>
        <div class="modal-footer">
            <button class="btn btn-primary" id="opsDoInstall">开始安装</button>
        </div>`;

        if (deployedOnHost.length > 0) {
            const sel = el.querySelector('#opsPkgSelect');
            sel.value = deployedOnHost[deployedOnHost.length - 1].pkgName;
        }
        if (isSafeline) bindDeployModeSwitch('ops');
        el.querySelector('#opsDoInstall').addEventListener('click', () => doOpsInstall(hostId));
    }

    // ── Upgrade panel ──
    function renderUpgradePanel(el, hostId) {
        const installDir = _opsProduct.id === 'safeline' ? '/data/safeline' : '/data/cloudwalker';
        el.innerHTML = `
        <div class="form-group">
            <label>安装目录</label>
            <input type="text" id="opsUpgradeInstallDir" placeholder="${installDir}" style="width:100%">
        </div>
        <div class="modal-footer">
            <button class="btn btn-primary" id="opsDoUpgrade">开始升级</button>
        </div>`;
        el.querySelector('#opsDoUpgrade').addEventListener('click', () => {
            const installDir = document.getElementById('opsUpgradeInstallDir').value.trim() || (_opsProduct.id === 'safeline' ? '/data/safeline' : '/data/cloudwalker');
            document.getElementById('hostOpsModal').classList.remove('active');
            runUpgrade(hostId, installDir);
        });
    }

    // ── Uninstall panel ──
    function renderUninstallPanel(el, hostId) {
        const installDir = _opsProduct.id === 'safeline' ? '/data/safeline' : '/data/cloudwalker';
        const isSafeline = _opsProduct.id === 'safeline';
        el.innerHTML = `
        <div class="form-group">
            <div style="background:#fef2f2;border-left:3px solid var(--danger);padding:12px 14px;border-radius:0 6px 6px 0;font-size:0.875rem;color:#991b1b">
                ⚠ 卸载将清除 ${esc(_opsProduct.name)} <strong>所有数据</strong>，包括配置、规则、日志，操作不可逆。请确认后继续。
            </div>
        </div>
        <div class="form-group">
            <label>参考安装目录（留空则自动探测）</label>
            <input type="text" id="opsUninstallDir" placeholder="留空自动探测，或填 /data/safeline" style="width:100%">
        </div>
        ${isSafeline ? `
        <div class="form-group" style="border-bottom:none">
            <label style="display:flex;align-items:center;gap:8px;cursor:pointer;margin-bottom:0">
                <input type="checkbox" id="opsUninstallDocker" style="width:16px;height:16px;accent-color:var(--danger)">
                同时彻底卸载 Docker
            </label>
            <div id="opsDockerDataOpts" style="margin-top:8px;padding-left:24px;display:none">
                <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:0.82rem;color:var(--text-muted)">
                    <input type="checkbox" id="opsRemoveDockerData" style="width:14px;height:14px;accent-color:var(--danger)">
                    同时删除所有 Docker 镜像、容器、数据卷（/var/lib/docker）
                </label>
            </div>
        </div>` : ''}
        <div class="modal-footer">
            <button class="btn btn-danger" id="opsDoUninstall">确认卸载</button>
        </div>`;
        if (isSafeline) {
            const cb = el.querySelector('#opsUninstallDocker');
            if (cb) cb.addEventListener('change', function() {
                el.querySelector('#opsDockerDataOpts').style.display = this.checked ? 'block' : 'none';
            });
        }
        el.querySelector('#opsDoUninstall').addEventListener('click', () => {
            const installDir = document.getElementById('opsUninstallDir')?.value.trim() || (_opsProduct.id === 'safeline' ? '/data/safeline' : '/data/cloudwalker');
            const uninstallDocker = document.getElementById('opsUninstallDocker')?.checked || false;
            const removeDockerData = document.getElementById('opsRemoveDockerData')?.checked || false;
            document.getElementById('hostOpsModal').classList.remove('active');
            runUninstall(hostId, installDir, uninstallDocker, removeDockerData, '', '');
        });
    }

    // ── Manage panel ──
    function renderManagePanel(el, hostId) {
        if (_opsProduct.id === 'safeline') {
            renderSafelineManage(el);
        } else if (_opsProduct.id === 'cloudwalker') {
            renderCloudwalkerManage(el);
        }
    }

    function renderSafelineManage(el) {
        el.innerHTML = `
        <div class="ops-config-bar">
            <div class="sl-config-row">
                <div class="form-inline">
                    <label>API 地址</label>
                    <input type="text" id="slUrl" placeholder="https://192.168.1.10:9443" style="width:220px">
                </div>
                <div class="form-inline">
                    <label>API Token</label>
                    <input type="password" id="slToken" placeholder="SafeLine API-Token" style="width:220px">
                </div>
                <button class="btn btn-secondary" id="slTestBtn">测试连接</button>
                <button class="btn btn-primary" id="slSaveBtn">保存配置</button>
                <span id="slConfigStatus" class="sl-config-status"></span>
            </div>
        </div>
        <div class="ops-manage-actions">
            <div class="ops-manage-card" id="opsSlOpenWeb">
                <div class="ops-manage-icon">&#x1F310;</div>
                <div class="ops-manage-title">打开管理页面</div>
                <div class="ops-manage-desc">跳转到该设备的管理后台</div>
            </div>
            <div class="ops-manage-card" id="opsSlAiChat">
                <div class="ops-manage-icon">&#x1F4AC;</div>
                <div class="ops-manage-title">AI 对话配置</div>
                <div class="ops-manage-desc">通过自然语言管理设备配置</div>
            </div>
        </div>`;
        // Bind config buttons inline (not bindSafeLine - that tries to bind removed elements)
        document.getElementById('slTestBtn').addEventListener('click', () => {
            const url = document.getElementById('slUrl').value.trim();
            const token = document.getElementById('slToken').value.trim();
            if (!url || !token) { showToast('请填写 API 地址和 Token', 'error'); return; }
            document.getElementById('slConfigStatus').textContent = '测试中...';
            document.getElementById('slConfigStatus').className = 'sl-config-status';
            fetch(SL + '/test', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url, token }) })
                .then(r => r.json()).then(d => {
                    if (d.err || d.error) { document.getElementById('slConfigStatus').textContent = '失败: ' + (d.error || JSON.stringify(d.err)); document.getElementById('slConfigStatus').className = 'sl-config-status sl-status-error'; return; }
                    document.getElementById('slConfigStatus').textContent = '连接成功';
                    document.getElementById('slConfigStatus').className = 'sl-config-status sl-status-ok';
                }).catch(e => { document.getElementById('slConfigStatus').textContent = '请求失败: ' + e.message; document.getElementById('slConfigStatus').className = 'sl-config-status sl-status-error'; });
        });
        document.getElementById('slSaveBtn').addEventListener('click', () => {
            const url = document.getElementById('slUrl').value.trim();
            const token = document.getElementById('slToken').value.trim();
            if (!url || !token) { showToast('请填写 API 地址和 Token', 'error'); return; }
            document.getElementById('slConfigStatus').textContent = '保存中...';
            document.getElementById('slConfigStatus').className = 'sl-config-status';
            fetch(SL + '/config', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url, token }) })
                .then(r => r.json()).then(d => {
                    if (d.error) { document.getElementById('slConfigStatus').textContent = '失败: ' + d.error; document.getElementById('slConfigStatus').className = 'sl-config-status sl-status-error'; return; }
                    document.getElementById('slConfigStatus').textContent = '配置已保存';
                    document.getElementById('slConfigStatus').className = 'sl-config-status sl-status-ok';
                    showToast('API 配置已保存', 'success');
                }).catch(e => { document.getElementById('slConfigStatus').textContent = '请求失败'; document.getElementById('slConfigStatus').className = 'sl-config-status sl-status-error'; });
        });
        // Load saved config
        loadSafeLineConfig();
        // Open management page
        el.querySelector('#opsSlOpenWeb').addEventListener('click', () => {
            const url = document.getElementById('slUrl').value.trim();
            if (!url) { showToast('请先配置 API 地址', 'error'); return; }
            window.open(url, '_blank');
        });
        // AI chat
        el.querySelector('#opsSlAiChat').addEventListener('click', () => {
            const host = state.hosts.find(h => h.id === _opsHostId);
            document.getElementById('hostOpsModal').classList.remove('active');
            document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === 'chat'));
            document.querySelectorAll('.tab-content').forEach(s => s.classList.toggle('active', s.id === 'tab-chat'));
            state.currentTab = 'chat';
            const chatHostSel = document.getElementById('chatHostSelect');
            if (_opsHostId && chatHostSel) { chatHostSel.value = _opsHostId; updateChatContextHint(); }
            const settings = JSON.parse(localStorage.getItem('cve_settings') || '{}');
            if (!settings.apiUrl || !settings.apiKey) {
                showToast('请先在设置中配置 AI 接口', 'error');
                document.getElementById('chatInput').focus();
                return;
            }
            const chatInput = document.getElementById('chatInput');
            chatInput.value = '';
            chatInput.focus();
            const hostInfo = host ? `（主机: ${host.name}）` : '';
            sendChatMsg(`请帮我管理该设备的配置${hostInfo}，包括产品部署状态检查、服务配置、策略调整等`);
        });
    }

    function renderCloudwalkerManage(el) {
        el.innerHTML = `
        <div class="ops-config-bar">
            <div class="sl-config-row">
                <div class="form-inline">
                    <label>API 地址</label>
                    <input type="text" id="cwUrl" placeholder="https://192.168.36.116" style="width:220px">
                </div>
                <div class="form-inline">
                    <label>API Token</label>
                    <input type="password" id="cwToken" placeholder="CloudWalker API-Token" style="width:220px">
                </div>
                <button class="btn btn-secondary" id="cwTestBtn">测试连接</button>
                <button class="btn btn-primary" id="cwSaveBtn">保存配置</button>
                <span id="cwConfigStatus" class="sl-config-status"></span>
            </div>
        </div>
        <div class="ops-manage-actions">
            <div class="ops-manage-card" id="opsCwOpenWeb">
                <div class="ops-manage-icon">&#x1F310;</div>
                <div class="ops-manage-title">打开管理页面</div>
                <div class="ops-manage-desc">跳转到该设备的管理后台</div>
            </div>
            <div class="ops-manage-card" id="opsCwAiChat">
                <div class="ops-manage-icon">&#x1F4AC;</div>
                <div class="ops-manage-title">AI 对话配置</div>
                <div class="ops-manage-desc">通过自然语言管理设备配置</div>
            </div>
        </div>`;
        // Bind config buttons inline (not bindCloudWalker - that tries to bind removed elements)
        document.getElementById('cwTestBtn').addEventListener('click', () => {
            const url = document.getElementById('cwUrl').value.trim();
            const token = document.getElementById('cwToken').value.trim();
            if (!url || !token) { showToast('请填写 API 地址和 Token', 'error'); return; }
            const st = document.getElementById('cwConfigStatus');
            st.textContent = '测试中...'; st.className = 'sl-config-status';
            fetch(CW + '/test', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url, token }) })
                .then(r => r.json()).then(d => {
                    if (d.error) { st.textContent = '失败: ' + d.error; st.className = 'sl-config-status sl-status-error'; return; }
                    st.textContent = '连接成功'; st.className = 'sl-config-status sl-status-ok';
                }).catch(e => { st.textContent = '请求失败: ' + e.message; st.className = 'sl-config-status sl-status-error'; });
        });
        document.getElementById('cwSaveBtn').addEventListener('click', () => {
            const url = document.getElementById('cwUrl').value.trim();
            const token = document.getElementById('cwToken').value.trim();
            if (!url || !token) { showToast('请填写 API 地址和 Token', 'error'); return; }
            const st = document.getElementById('cwConfigStatus');
            st.textContent = '保存中...'; st.className = 'sl-config-status';
            fetch(CW + '/config', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url, token }) })
                .then(r => r.json()).then(d => {
                    if (d.error) { st.textContent = '失败: ' + d.error; st.className = 'sl-config-status sl-status-error'; return; }
                    st.textContent = '配置已保存'; st.className = 'sl-config-status sl-status-ok';
                    showToast('API 配置已保存', 'success');
                }).catch(e => { st.textContent = '请求失败'; st.className = 'sl-config-status sl-status-error'; });
        });
        loadCloudWalkerConfig();
        el.querySelector('#opsCwOpenWeb').addEventListener('click', () => {
            const url = document.getElementById('cwUrl').value.trim();
            if (!url) { showToast('请先配置 API 地址', 'error'); return; }
            window.open(url, '_blank');
        });
        el.querySelector('#opsCwAiChat').addEventListener('click', () => {
            const host = state.hosts.find(h => h.id === _opsHostId);
            document.getElementById('hostOpsModal').classList.remove('active');
            document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === 'chat'));
            document.querySelectorAll('.tab-content').forEach(s => s.classList.toggle('active', s.id === 'tab-chat'));
            state.currentTab = 'chat';
            const chatHostSel = document.getElementById('chatHostSelect');
            if (_opsHostId && chatHostSel) { chatHostSel.value = _opsHostId; updateChatContextHint(); }
            const settings = JSON.parse(localStorage.getItem('cve_settings') || '{}');
            if (!settings.apiUrl || !settings.apiKey) {
                showToast('请先在设置中配置 AI 接口', 'error');
                document.getElementById('chatInput').focus();
                return;
            }
            const chatInput = document.getElementById('chatInput');
            chatInput.value = '';
            chatInput.focus();
            const hostInfo = host ? `（主机: ${host.name}）` : '';
            sendChatMsg(`请帮我管理该设备的配置${hostInfo}，包括产品部署状态检查、服务配置、策略调整等`);
        });
    }

    // ── SafeLine deploy mode HTML ──
    function renderSafelineDeployModes(prefix) {
        return `
        <div class="form-group">
            <label>部署模式</label>
            <div class="deploy-mode-group deploy-mode-grid">
                <label class="mode-card">
                    <input type="radio" name="${prefix}DeplMode" value="software" checked>
                    <div class="mode-card-body"><div class="mode-title">软件反代单机</div><div class="mode-desc">最常用，单节点反向代理</div></div>
                </label>
                <label class="mode-card">
                    <input type="radio" name="${prefix}DeplMode" value="s20_management">
                    <div class="mode-card-body"><div class="mode-title">反代集群-管理节点</div><div class="mode-desc">集群管理节点</div></div>
                </label>
                <label class="mode-card">
                    <input type="radio" name="${prefix}DeplMode" value="s20_agent">
                    <div class="mode-card-body"><div class="mode-title">反代集群-检测节点</div><div class="mode-desc">集群检测/转发节点</div></div>
                </label>
                <label class="mode-card">
                    <input type="radio" name="${prefix}DeplMode" value="c20_master">
                    <div class="mode-card-body"><div class="mode-title">嵌入式单机/集群管理</div><div class="mode-desc">T1k 协议嵌入式</div></div>
                </label>
                <label class="mode-card">
                    <input type="radio" name="${prefix}DeplMode" value="c20_slave">
                    <div class="mode-card-body"><div class="mode-title">嵌入式集群-检测节点</div><div class="mode-desc">嵌入式检测节点</div></div>
                </label>
                <label class="mode-card">
                    <input type="radio" name="${prefix}DeplMode" value="traffic_mirror">
                    <div class="mode-card-body"><div class="mode-title">软件流量镜像</div><div class="mode-desc">旁路镜像检测</div></div>
                </label>
            </div>
        </div>
        <div id="${prefix}MgmtOpts" style="display:none">
            <div class="form-group">
                <label>管理节点服务范围</label>
                <div style="display:flex;flex-direction:column;gap:4px">
                    <label style="display:flex;align-items:center;gap:6px;cursor:pointer"><input type="radio" name="${prefix}MgmtFlavor" value="full" checked><span>完整部署</span></label>
                    <label style="display:flex;align-items:center;gap:6px;cursor:pointer"><input type="radio" name="${prefix}MgmtFlavor" value="block-service"><span>仅管理（不含检测/转发）</span></label>
                    <label style="display:flex;align-items:center;gap:6px;cursor:pointer"><input type="radio" name="${prefix}MgmtFlavor" value="web-config"><span>仅管理（6767 页面配置）</span></label>
                </div>
            </div>
        </div>
        <div id="${prefix}AgentOpts" style="display:none">
            <div class="form-group">
                <label>管理节点地址</label>
                <input type="text" id="${prefix}ManagementAddr" placeholder="https://192.168.1.10:9443" style="width:100%">
            </div>
        </div>`;
    }

    function bindDeployModeSwitch(prefix) {
        document.querySelectorAll('input[name="' + prefix + 'DeplMode"]').forEach(r => {
            r.addEventListener('change', () => {
                const agentModes = ['s20_agent', 'c20_slave'];
                const mgmtModes = ['s20_management', 'c20_master'];
                const mgmtEl = document.getElementById(prefix + 'MgmtOpts');
                const agentEl = document.getElementById(prefix + 'AgentOpts');
                if (mgmtEl) mgmtEl.style.display = mgmtModes.includes(r.value) ? 'block' : 'none';
                if (agentEl) agentEl.style.display = agentModes.includes(r.value) ? 'block' : 'none';
            });
        });
    }

    function doOpsInstall(hostId) {
        const pkgFromSel = document.getElementById('opsPkgSelect')?.value;
        const pkgFromPath = document.getElementById('opsPkgPath')?.value.trim();
        if (!pkgFromSel && !pkgFromPath) { showToast('请选择安装包或填写路径', 'error'); return; }
        const pkgName = pkgFromSel || pkgFromPath.split('/').pop();

        const mode = _opsProduct.id === 'safeline'
            ? (document.querySelector('input[name="opsDeplMode"]:checked')?.value || 'software')
            : 'software';
        const modeOpts = { mode };
        modeOpts.installDir = document.getElementById('opsInstallDir')?.value.trim() || (_opsProduct.id === 'safeline' ? '/data/safeline' : '/data/cloudwalker');
        if (_opsProduct.id === 'safeline') {
            modeOpts.managementAddr = document.getElementById('opsManagementAddr')?.value.trim() || '';
            const mgmtModes = ['s20_management', 'c20_master'];
            if (mgmtModes.includes(mode)) {
                const flavorEl = document.querySelector('input[name="opsMgmtFlavor"]:checked');
                modeOpts.mgmtFlavor = flavorEl ? flavorEl.value : 'full';
            }
        }
        const installMethod = document.querySelector('input[name="opsInstallMethod"]:checked')?.value || 'kb';

        document.getElementById('hostOpsModal').classList.remove('active');

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
                    if (!foundPath) { appendTerminal('未在目标主机上找到安装包，请手动填写路径', 'error'); return; }
                    state.deployedPkgs.push({ pkgName, hostId, remotePath: foundPath, time: new Date().toLocaleTimeString() });
                    localStorage.setItem('ve_deployed_pkgs', JSON.stringify(state.deployedPkgs));
                    appendTerminal('找到安装包: ' + foundPath, 'system');
                    doInstall(foundPath);
                }, (line) => {
                    if (!foundPath && line.trim().startsWith('/')) { foundPath = line.trim(); }
                });
            });
        }
    }

    function runUpgrade(hostId, installDir) {
        if (_opsProduct.id === 'cloudwalker') {
            runCloudWalkerUpgrade(hostId, installDir);
            return;
        }
        document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === 'execute'));
        document.querySelectorAll('.tab-content').forEach(s => s.classList.toggle('active', s.id === 'tab-execute'));
        document.getElementById('hostSelect').value = hostId;
        state.currentTab = 'execute';
        appendTerminal('=== 开始升级 WAF ===', 'system');

        const cmds = [
            { label: '[1] 执行 minion setup -m',    cmd: 'minion setup -m' },
            { label: '[2] 重启 minion 服务',         cmd: 'systemctl restart minion' },
            { label: '[3] 等待服务启动',              cmd: 'sleep 15' },
            { label: '[4] 验证容器状态',              cmd: 'docker ps -a' },
        ];
        runCommandsSequentially(hostId, cmds, 0);
    }

    function runCloudWalkerUpgrade(hostId, installDir) {
        document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === 'execute'));
        document.querySelectorAll('.tab-content').forEach(s => s.classList.toggle('active', s.id === 'tab-execute'));
        document.getElementById('hostSelect').value = hostId;
        state.currentTab = 'execute';
        appendTerminal('=== 开始升级 CloudWalker ===', 'system');
        const cmds = [
            { label: '[1] 检查安装目录', cmd: 'test -d ' + JSON.stringify(installDir) + ' && cd ' + JSON.stringify(installDir) + ' && pwd' },
            { label: '[2] 执行升级/重建编排', cmd: 'cd ' + JSON.stringify(installDir) + ' && ./minion compose up' },
            { label: '[3] 验证容器状态', cmd: 'cd ' + JSON.stringify(installDir) + ' && ./minion compose ps || docker ps -a' },
        ];
        runCommandsSequentially(hostId, cmds, 0);
    }

    // SafeLine 卸载的核心函数
    // 三段式：1) 安装时记录的 install-info → 2) 用户填写的路径 → 3) 从雷池自身机制探测
    function runUninstall(hostId, installDir, uninstallDocker, removeDockerData, pkgName, pkgRemotePath) {
        if (_opsProduct.id === 'cloudwalker') {
            runCloudWalkerUninstall(hostId, installDir);
            return;
        }
        document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === 'execute'));
        document.querySelectorAll('.tab-content').forEach(s => s.classList.toggle('active', s.id === 'tab-execute'));
        document.getElementById('hostSelect').value = hostId;
        state.currentTab = 'execute';
        appendTerminal('=== 开始卸载 WAF ===', 'system');

        // 判断是否需要探测安装路径（installDir 来自用户输入或默认值）
        const needDiscover = false; // installDir 已由调用方提供

        if (needDiscover) {
            appendTerminal('--- 探测安装路径 ---', 'system');

            // 三级探测：install-info → systemd → 默认标准路径
            const discoverCmd = [
                'R=""',
                'if [ -f /root/.safeline-install-info ]; then R=$(grep "^INSTALL_DIR:" /root/.safeline-install-info | cut -d: -f2); fi',
                'if [ -z "$R" ] && [ -f /etc/systemd/system/minion.service ]; then R=$(grep -oP "(?<=WorkingDirectory=)\\S+" /etc/systemd/system/minion.service 2>/dev/null); fi',
                'if [ -z "$R" ] && [ -d /data/safeline ]; then R="/data/safeline"; fi',
                "echo \"__FOUND__:${R}\"",
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

    function runCloudWalkerUninstall(hostId, installDir) {
        document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === 'execute'));
        document.querySelectorAll('.tab-content').forEach(s => s.classList.toggle('active', s.id === 'tab-execute'));
        document.getElementById('hostSelect').value = hostId;
        state.currentTab = 'execute';
        appendTerminal('=== 开始卸载 CloudWalker ===', 'system');
        const qDir = JSON.stringify(installDir || '/data/cloudwalker');
        const cmds = [
            { label: '[1] 停止 minion', cmd: 'systemctl stop minion 2>/dev/null || true', failOk: true },
            { label: '[2] 停止巡检定时器', cmd: 'systemctl stop healthcheck.timer 2>/dev/null; systemctl disable healthcheck.timer 2>/dev/null; echo "[OK]"', failOk: true },
            { label: '[3] 停止 CloudWalker 编排', cmd: 'cd ' + qDir + ' 2>/dev/null && ./minion compose down || true', failOk: true },
            { label: '[4] 禁用服务', cmd: 'systemctl disable minion 2>/dev/null || true', failOk: true },
            { label: '[5] 清理文件', cmd: 'case ' + qDir + ' in ""|"/"|"/data"|"/opt") echo "危险目录，拒绝删除"; exit 1;; esac; rm -rf ' + qDir + ' /etc/systemd/system/minion.service /usr/local/bin/minion 2>/dev/null; systemctl daemon-reload 2>/dev/null; systemctl reset-failed 2>/dev/null; echo "[OK]"' },
            { label: '[6] 验证清理结果', cmd: '[ -d ' + qDir + ' ] && echo "[残留] ' + (installDir || '/data/cloudwalker') + '" || echo "[干净] ' + (installDir || '/data/cloudwalker') + '"; systemctl list-unit-files | grep -i "minion\\|healthcheck" || true', failOk: true },
        ];
        runCommandsSequentially(hostId, cmds, 0);
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
            const cmds = _opsProduct.id === 'cloudwalker'
                ? buildCloudWalkerInstallCommands(pkgName, remotePath, modeOpts, pass)
                : buildInstallCommands(pkgName, remotePath, modeOpts, pass);
            const isMgmt = _opsProduct.id === 'safeline' && ['s20_management', 'c20_master'].includes(modeOpts.mode);
            runCommandsSequentially(hostId, cmds, 0, isMgmt ? () => extractMgmtCredentials(hostId, modeOpts.installDir) : null);
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

    function extractMgmtCredentials(hostId, installDir) {
        const host = state.hosts.find(h => h.id === hostId);
        const hostLabel = host ? host.name + ' (' + host.ip + ')' : hostId;
        const certPath = (installDir || '/data/safeline').replace(/\/+$/, '') + '/resources/management/certs/minion.crt';
        appendTerminal('--- 提取管理节点凭据 ---', 'system');

        const extractCmd = [
            'MYIP=$(hostname -I | awk \'{print $1}\')',
            'MADDR=$(minion db get /minion/v1/services/management_addr 2>/dev/null | sed "s|127\\.0\\.0\\.1|$MYIP|" || echo "")',
            'MTOKEN=$(minion db get /minion/v1/services/minion_api_token 2>/dev/null || echo "")',
            'MPASS=$(minion db get /minion/v1/services/postgres_password 2>/dev/null || echo "")',
            'MBOTJS=$(minion db get /minion/v1/bot_js_location 2>/dev/null || echo "")',
            'MCERT=$(cat ' + JSON.stringify(certPath) + ' 2>/dev/null | base64 -w 0 || echo "")',
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

    function buildCloudWalkerInstallCommands(pkgName, remotePath, modeOpts, pkgPass) {
        const installDir = modeOpts.installDir || '/data/cloudwalker';
        const cmds = [];
        cmds.push({ label: '[1] 检查系统资源', cmd: 'free -h && df -h ' + JSON.stringify(installDir.split('/').slice(0,2).join('/') || '/') + ' && timedatectl 2>/dev/null | grep "Time zone" || true', failOk: true });
        cmds.push({ label: '[2] 准备安装目录', cmd: 'swapoff -a 2>/dev/null || true; umask 0022; mkdir -p ' + JSON.stringify(installDir) });
        cmds.push({ label: '[3] 准备安装包', cmd: 'chmod +x ' + JSON.stringify(remotePath) });
        const shQuote = JSON.stringify;
        const installer = JSON.stringify(remotePath) + " -C ' + shQuote(installDir) + '";
        cmds.push({
            label: '[4] 解压并安装 CloudWalker',
            cmd: pkgPass ? 'printf %s\\n ' + JSON.stringify(pkgPass) + ' | ' + installer : installer,
        });
        cmds.push({ label: '[5] 启动 minion 服务', cmd: 'systemctl start minion || (cd ' + JSON.stringify(installDir) + ' && ./minion compose up)' });
        cmds.push({ label: '[6] 等待服务启动', cmd: 'sleep 15; cd ' + JSON.stringify(installDir) + ' 2>/dev/null && ./minion compose ps || docker ps -a' });
        cmds.push({ label: '[7] 获取访问地址', cmd: 'echo "管理界面：https://$(hostname -I | awk \'{print $1}\')/"', failOk: true });
        return cmds;
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
        const prodName = _opsProduct ? `${_opsProduct.name}（${_opsProduct.desc}）` : '产品';
        let task = `请帮我在远程主机上安装${prodName}。\n\n安装包已上传到：${remotePath}\n部署模式：${modeNames[mode] || mode}`;
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
        fetch(API + '/packages').then(r => {
            if (!r.ok) throw new Error('加载失败: ' + r.status);
            return r.json();
        }).then(pkgs => {
            state.packages = Array.isArray(pkgs) ? pkgs : [];
            const el = document.getElementById('pkgList');
            if (!state.packages.length) { el.innerHTML = '<div class="empty-state">暂无安装包</div>'; return; }
            el.innerHTML = state.packages.map(p => `
                <div class="pkg-card">
                    <div class="pkg-name">${esc(p.name)}</div>
                    <div class="pkg-meta">${fmtBytes(p.size)}</div>
                    <div class="pkg-actions">
                        <button class="btn btn-primary" onclick="window._deployPkg('${esc(p.name)}')">部署到主机</button>
                        <button class="btn btn-danger" onclick="window._deletePkg('${esc(p.name)}')">删除</button>
                    </div>
                </div>`).join('');
        }).catch(err => {
            showToast(err.message, 'error');
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
                .then(r => {
                    if (!r.ok) throw new Error('导入失败: ' + r.status);
                    return r.json();
                }).then(d => {
                    if (d.error) { showToast(d.error, 'error'); return; }
                    showToast('知识库导入成功', 'success');
                    loadKnowledge();
                }).catch(err => {
                    showToast(err.message, 'error');
                });
            e.target.value = '';
        });
        document.getElementById('btnRefreshKB').addEventListener('click', loadKnowledge);
    }

    function loadKnowledge() {
        fetch(API + '/knowledge').then(r => {
            if (!r.ok) throw new Error('加载失败: ' + r.status);
            return r.json();
        }).then(kbs => {
            const el = document.getElementById('kbList');
            if (!Array.isArray(kbs) || !kbs.length) { el.innerHTML = '<div class="empty-state">暂无知识库，点击右上角导入</div>'; return; }
            el.innerHTML = kbs.map(kb => `
                <div class="kb-card">
                    <div class="kb-name">${esc(kb.name)}</div>
                    <div class="kb-meta">v${esc(kb.version || '?')} · ${esc(kb.description || '')}</div>
                    <div class="kb-actions">
                        <button class="btn btn-secondary" onclick="window._viewKB('${kb.id}')">查看 Wiki</button>
                        <button class="btn btn-danger" onclick="window._deleteKB('${kb.id}')">删除</button>
                    </div>
                </div>`).join('');
        }).catch(err => {
            showToast(err.message, 'error');
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

        // Cancel any in-flight request
        if (window._chatAbortController) window._chatAbortController.abort();
        window._chatAbortController = new AbortController();

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
            signal: window._chatAbortController.signal,
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
            console.log('[chat] response status:', resp.status, 'ok:', resp.ok);
            if (!resp.ok) throw new Error('HTTP ' + resp.status);
            if (!resp.body) throw new Error('Server returned empty response body');
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
                    if (buffer.includes('\uFFFD')) {
                        console.warn('[chat] decode error detected, clearing buffer');
                        buffer = '';
                    }
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
                        console.log('[chat] SSE event:', data.type, data.role || '', (data.content || '').substring(0, 80));
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
                    document.getElementById('apiUrl').value = '';
                    document.getElementById('modelName').value = '';
                }
                document.querySelectorAll('.preset-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
            });
        });

        document.getElementById('settingsForm').addEventListener('submit', e => {
            e.preventDefault();
            const fd = new FormData(e.target);
            const cfg = { apiUrl: fd.get('apiUrl'), apiKey: fd.get('apiKey'), model: fd.get('model') };
            localStorage.setItem('cve_settings', JSON.stringify(cfg));
            // Sync AI config to server for threat intel analysis
            fetch(API + '/threatintel/save-ai-config', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url: cfg.apiUrl, key: cfg.apiKey, model: cfg.model })
            }).catch(() => {});
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

    // ── SafeLine WAF Management ────────────────────────────────────────────
    const SL = API + '/safeline';
    const slState = { logOffset: 0, logCount: 20, configLoaded: false };

    function bindSafeLine() {
        // Config
        document.getElementById('slTestBtn').addEventListener('click', () => {
            const url = document.getElementById('slUrl').value.trim();
            const token = document.getElementById('slToken').value.trim();
            if (!url || !token) { showToast('请填写 API 地址和 Token', 'error'); return; }
            document.getElementById('slConfigStatus').textContent = '测试中...';
            document.getElementById('slConfigStatus').className = 'sl-config-status';
            fetch(SL + '/test', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url, token }) })
                .then(r => r.json()).then(d => {
                    if (d.err) { document.getElementById('slConfigStatus').textContent = '失败: ' + JSON.stringify(d.err); document.getElementById('slConfigStatus').className = 'sl-config-status sl-status-error'; return; }
                    if (d.error) { document.getElementById('slConfigStatus').textContent = '失败: ' + d.error; document.getElementById('slConfigStatus').className = 'sl-config-status sl-status-error'; return; }
                    document.getElementById('slConfigStatus').textContent = '连接成功';
                    document.getElementById('slConfigStatus').className = 'sl-config-status sl-status-ok';
                }).catch(e => { document.getElementById('slConfigStatus').textContent = '请求失败: ' + e.message; document.getElementById('slConfigStatus').className = 'sl-config-status sl-status-error'; });
        });
        document.getElementById('slSaveBtn').addEventListener('click', () => {
            const url = document.getElementById('slUrl').value.trim();
            const token = document.getElementById('slToken').value.trim();
            if (!url || !token) { showToast('请填写 API 地址和 Token', 'error'); return; }
            document.getElementById('slConfigStatus').textContent = '保存中...';
            document.getElementById('slConfigStatus').className = 'sl-config-status';
            fetch(SL + '/config', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url, token }) })
                .then(r => r.json()).then(d => {
                    if (d.error) { document.getElementById('slConfigStatus').textContent = '失败: ' + d.error; document.getElementById('slConfigStatus').className = 'sl-config-status sl-status-error'; return; }
                    document.getElementById('slConfigStatus').textContent = '配置已保存';
                    document.getElementById('slConfigStatus').className = 'sl-config-status sl-status-ok';
                    showToast('API 配置已保存', 'success');
                }).catch(e => { document.getElementById('slConfigStatus').textContent = '请求失败'; document.getElementById('slConfigStatus').className = 'sl-config-status sl-status-error'; });
        });

        // Sub-tabs
        document.querySelectorAll('.sl-subtab[data-sl-tab^="sl-"]').forEach(tab => {
            tab.addEventListener('click', () => {
                document.querySelectorAll('.sl-subtab[data-sl-tab^="sl-"]').forEach(t => t.classList.toggle('active', t.dataset.slTab === tab.dataset.slTab));
                document.querySelectorAll('.sl-panel[id^="sl-"]').forEach(p => p.classList.toggle('active', p.id === tab.dataset.slTab));
            });
        });

        // Overview
        document.getElementById('slRefreshOverview').addEventListener('click', loadSLOverview);
        document.getElementById('slDuration').addEventListener('change', loadSLOverview);

        // Websites
        document.getElementById('slRefreshWebsites').addEventListener('click', loadSLWebsites);
        document.getElementById('slAddWebsite').addEventListener('click', () => {
            document.getElementById('slWebsiteForm').reset();
            document.getElementById('slWebsiteModalTitle').textContent = '新建站点';
            document.getElementById('slPolicySelect').innerHTML = '<option value="3">引擎防护配置默认模板</option><option value="null">不使用防护策略</option>';
            loadSLPolicies();
            document.getElementById('slWebsiteModal').classList.add('active');
        });
        document.getElementById('slWebHealthCheck').addEventListener('change', function() {
            document.getElementById('slWebHealthOpts').style.display = this.checked ? 'block' : 'none';
        });
        document.getElementById('slWebsiteForm').addEventListener('submit', e => {
            e.preventDefault();
            createSLWebsite(new FormData(e.target));
        });

        // IP Groups
        document.getElementById('slRefreshIPGroups').addEventListener('click', loadSLIPGroups);
        document.getElementById('slAddIPGroup').addEventListener('click', () => {
            document.getElementById('slIPGroupForm').reset();
            document.getElementById('slIPGroupModal').classList.add('active');
        });
        document.getElementById('slIPGroupForm').addEventListener('submit', e => {
            e.preventDefault();
            createSLIPGroup(new FormData(e.target));
        });

        // Logs
        document.getElementById('slRefreshLogs').addEventListener('click', () => { slState.logOffset = 0; loadSLLogs(); });
        document.getElementById('slLogFilter').addEventListener('keydown', e => { if (e.key === 'Enter') { slState.logOffset = 0; loadSLLogs(); } });

        // System
        document.getElementById('slRefreshSystem').addEventListener('click', loadSLSystem);
    }

    function loadSafeLineConfig() {
        fetch(SL + '/config').then(r => {
            if (!r.ok) throw new Error('加载配置失败: ' + r.status);
            return r.json();
        }).then(cfg => {
            if (cfg.url) document.getElementById('slUrl').value = cfg.url;
            if (cfg.token) document.getElementById('slToken').value = cfg.token;
            if (cfg.url && cfg.token) {
                document.getElementById('slConfigStatus').textContent = '已配置';
                document.getElementById('slConfigStatus').className = 'sl-config-status sl-status-ok';
            }
        }).catch(err => {
            showToast(err.message, 'error');
        });
    }

    function slFetch(path, opts) {
        return fetch(SL + path, opts).then(r => {
            if (!r.ok) throw new Error('API 请求失败: ' + r.status);
            return r.json();
        }).then(d => {
            if (d.error) throw new Error(d.error);
            return d;
        }).catch(err => {
            showToast('请求失败: ' + err.message, 'error');
            throw err;
        });
    }

    // ── Overview ──
    function loadSLOverview() {
        const duration = document.getElementById('slDuration').value;
        const el = document.getElementById('slOverviewCards');
        el.innerHTML = '<div class="empty-state">加载中...</div>';
        slFetch('/overview?duration=' + duration).then(data => {
            const d = data.data || {};
            const cards = [
                { label: '总请求数', value: fmtNum(d.total_number || 0), color: 'var(--primary)' },
                { label: '攻击次数', value: fmtNum(d.attack_number || 0), color: 'var(--danger)' },
                { label: '拦截次数', value: fmtNum(d.blocked_number || 0), color: '#f59e0b' },
                { label: '拦截率', value: d.total_number ? ((d.blocked_number / d.total_number) * 100).toFixed(2) + '%' : '0%', color: 'var(--success)' },
            ];
            el.innerHTML = cards.map(c => `
                <div class="sl-stat-card">
                    <div class="sl-stat-value" style="color:${c.color}">${c.value}</div>
                    <div class="sl-stat-label">${c.label}</div>
                </div>`).join('');

            // Attack type breakdown
            const extra = document.getElementById('slOverviewExtra');
            const types = d.attack_type || {};
            if (Object.keys(types).length > 0) {
                const sorted = Object.entries(types).sort((a, b) => b[1] - a[1]).slice(0, 10);
                extra.innerHTML = '<h3 style="font-size:0.95rem;margin-bottom:10px">攻击类型 TOP 10</h3><div class="sl-type-grid">' +
                    sorted.map(([name, count]) => `
                        <div class="sl-type-row">
                            <span class="sl-type-name">${esc(name)}</span>
                            <div class="sl-type-bar-wrap"><div class="sl-type-bar" style="width:${(count / sorted[0][1]) * 100}%"></div></div>
                            <span class="sl-type-count">${fmtNum(count)}</span>
                        </div>`).join('') + '</div>';
            } else {
                extra.innerHTML = '';
            }
        }).catch(e => { el.innerHTML = '<div class="empty-state">加载失败: ' + esc(e.message) + '</div>'; });
    }

    // ── Websites ──
    function loadSLWebsites() {
        const mode = document.getElementById('slWebMode').value;
        const el = document.getElementById('slWebsiteList');
        el.innerHTML = '<div class="empty-state">加载中...</div>';
        slFetch('/websites?mode=' + mode).then(data => {
            const items = data.data || [];
            if (!items.length) { el.innerHTML = '<div class="empty-state">暂无站点</div>'; return; }
            el.innerHTML = '<table class="sl-table"><thead><tr><th>站点名称</th><th>域名</th><th>后端</th><th>状态</th><th>防护策略</th><th>操作</th></tr></thead><tbody>' +
                items.map(w => {
                    const domains = (w.server_names || []).join(', ');
                    const servers = (w.backend_config?.servers || []).map(s => s.host + ':' + s.port).join(', ');
                    return `
                    <tr>
                        <td><strong>${esc(w.name)}</strong></td>
                        <td>${esc(domains || '-')}</td>
                        <td>${esc(servers || '-')}</td>
                        <td><span class="sl-badge ${w.is_enabled ? 'sl-badge-ok' : 'sl-badge-off'}">${w.is_enabled ? '启用' : '禁用'}</span></td>
                        <td>${w.policy_group ? esc(w.policy_group.name || '-') : '<span class="sl-badge sl-badge-off">无</span>'}</td>
                        <td class="sl-actions-cell">
                            <button class="btn btn-secondary btn-sm" onclick="window._slToggleWeb(${w.id},${!w.is_enabled})">${w.is_enabled ? '禁用' : '启用'}</button>
                            <button class="btn btn-danger btn-sm" onclick="window._slDeleteWeb(${w.id},'${mode}')">删除</button>
                        </td>
                    </tr>`;}).join('') + '</tbody></table>';
        }).catch(e => { el.innerHTML = '<div class="empty-state">加载失败: ' + esc(e.message) + '</div>'; });
    }

    function loadSLPolicies() {
        slFetch('/policies').then(data => {
            const items = data.data || [];
            const sel = document.getElementById('slPolicySelect');
            sel.innerHTML = items.map(p => `<option value="${p.id}">${esc(p.name || p.id)}</option>`).join('') +
                '<option value="null">不使用防护策略</option>';
        }).catch(() => {});
    }

    function createSLWebsite(fd) {
        const domain = fd.get('domain');
        const upstream = fd.get('upstream');
        const policyGroupId = fd.get('policy_group');
        const mode = fd.get('mode');
        const hcEnabled = document.getElementById('slWebHealthCheck').checked;
        const [upstreamHost, upstreamPortStr] = upstream.split(':');
        const upstreamPort = parseInt(upstreamPortStr) || 80;

        const body = {
            mode,
            name: domain,
            server_names: [domain],
            ip: ["0.0.0.0", "::"],
            interface: "virtual",
            ports: [{ port: 80, ssl: false, http2: false, sni: false, is_double_cert: false }],
            addrs: [{ port: 80, ssl: false }],
            backend_config: {
                type: "proxy",
                load_balance_policy: "Round Robin",
                x_forwarded_for_action: "append",
                servers: [{ host: upstreamHost, port: upstreamPort, protocol: "http", weight: 1, is_enabled: true }],
                health_check_config: {
                    is_enabled: hcEnabled,
                    check_type: hcEnabled ? (fd.get('hc_protocol') || 'http') : "http",
                    host: hcEnabled ? (fd.get('hc_host') || upstreamHost) : upstreamHost,
                    port: hcEnabled ? (parseInt(fd.get('hc_port')) || upstreamPort) : upstreamPort,
                    path: "/",
                    method: "GET",
                    interval: 10000,
                    timeout: 5000,
                    fall: 3,
                    rise: 2,
                    check_http_expect_alive: ["http_2xx", "http_3xx"],
                },
            },
            session_method: { type: "off" },
            advanced_cache: false,
            ignore_cert: false,
            ntlm_enabled: false,
            url_paths: [{ op: "pre", url_path: "/" }],
            detector_ip_source: ["Socket"],
            detector_ip_source_from: "local",
            access_log: { is_enabled: true, log_option: "Non-Persistence", req_body: true, rsp_body: false, log_request_header: false, log_response_header: false },
            proxy_bind_config: { enable: false, hash_select_ip_method: "remote_addr_and_port", proxy_ip_list: null },
            selected_tengine: { tengine_list: null, type: "all" },
            asset_group: 1,
            ssl_cert: null,
            ssl_ciphers: "",
            ssl_gm_cert: null,
            ssl_protocols: [],
            remark: "",
        };
        body.policy_group = policyGroupId === 'null' ? null : parseInt(policyGroupId);

        fetch(SL + '/websites', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
            .then(r => {
                if (!r.ok) throw new Error('请求失败: ' + r.status);
                return r.json();
            }).then(d => {
                if (d.error) { showToast('创建失败: ' + d.error, 'error'); return; }
                if (d.err) { showToast('创建失败: ' + JSON.stringify(d.err), 'error'); return; }
                showToast('站点创建成功', 'success');
                document.getElementById('slWebsiteModal').classList.remove('active');
                loadSLWebsites();
            }).catch(e => showToast('创建失败: ' + e.message, 'error'));
    }

    window._slToggleWeb = function(id, enabled) {
        fetch(SL + '/websites/' + id + '/toggle', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled }) })
            .then(r => r.json()).then(d => {
                if (d.err) { showToast('操作失败: ' + JSON.stringify(d.err), 'error'); return; }
                showToast(enabled ? '已启用' : '已禁用', 'success');
                loadSLWebsites();
            });
    };

    window._slDeleteWeb = function(id, mode) {
        if (!confirm('确定删除该站点？')) return;
        fetch(SL + '/websites/' + id + '?mode=' + mode, { method: 'DELETE' })
            .then(r => r.json()).then(d => {
                if (d.err) { showToast('删除失败: ' + JSON.stringify(d.err), 'error'); return; }
                showToast('已删除', 'success');
                loadSLWebsites();
            });
    };

    // ── IP Groups ──
    function loadSLIPGroups() {
        const el = document.getElementById('slIPGroupList');
        el.innerHTML = '<div class="empty-state">加载中...</div>';
        slFetch('/ip-groups').then(data => {
            const items = data.data || [];
            if (!items.length) { el.innerHTML = '<div class="empty-state">暂无 IP 组</div>'; return; }
            el.innerHTML = '<table class="sl-table"><thead><tr><th>名称</th><th>类型</th><th>IP 数量</th><th>操作</th></tr></thead><tbody>' +
                items.map(g => `
                    <tr>
                        <td><strong>${esc(g.name)}</strong></td>
                        <td><span class="sl-badge ${g.type === 1 ? 'sl-badge-block' : 'sl-badge-ok'}">${g.type === 1 ? '黑名单' : '白名单'}</span></td>
                        <td>${(g.ip_list || []).length}</td>
                        <td class="sl-actions-cell">
                            <button class="btn btn-danger btn-sm" onclick="window._slDeleteIPGroup(${g.id})">删除</button>
                        </td>
                    </tr>`).join('') + '</tbody></table>';
        }).catch(e => { el.innerHTML = '<div class="empty-state">加载失败: ' + esc(e.message) + '</div>'; });
    }

    function createSLIPGroup(fd) {
        const ips = fd.get('ips').split('\n').map(s => s.trim()).filter(Boolean);
        const body = { name: fd.get('name'), type: parseInt(fd.get('type')), ip_list: ips };
        fetch(SL + '/ip-groups', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
            .then(r => r.json()).then(d => {
                if (d.error) { showToast('创建失败: ' + d.error, 'error'); return; }
                if (d.err) { showToast('创建失败: ' + JSON.stringify(d.err), 'error'); return; }
                showToast('IP 组创建成功', 'success');
                document.getElementById('slIPGroupModal').classList.remove('active');
                loadSLIPGroups();
            }).catch(e => showToast('创建失败: ' + e.message, 'error'));
    }

    window._slDeleteIPGroup = function(id) {
        if (!confirm('确定删除该 IP 组？')) return;
        fetch(SL + '/ip-groups/' + id, { method: 'DELETE' })
            .then(r => r.json()).then(d => {
                if (d.err) { showToast('删除失败', 'error'); return; }
                showToast('已删除', 'success');
                loadSLIPGroups();
            });
    };

    // ── Attack Logs ──
    function loadSLLogs() {
        const filter = document.getElementById('slLogFilter').value.trim();
        const el = document.getElementById('slLogList');
        el.innerHTML = '<div class="empty-state">加载中...</div>';
        let url = '/logs?scope=log:detect_log&count=' + slState.logCount + '&offset=' + slState.logOffset;
        if (filter) url += '&q=' + encodeURIComponent(filter);
        slFetch(url).then(data => {
            const items = data.data?.items || [];
            const total = data.data?.total || 0;
            if (!items.length) { el.innerHTML = '<div class="empty-state">暂无日志</div>'; renderSLLogPagination(total); return; }
            el.innerHTML = '<table class="sl-table sl-log-table"><thead><tr><th>时间</th><th>来源 IP</th><th>目标域名</th><th>攻击类型</th><th>风险等级</th><th>规则</th></tr></thead><tbody>' +
                items.map(l => {
                    const time = l.time ? new Date(l.time).toLocaleString() : '-';
                    const srcIp = l.src_ip || l.source_ip || '-';
                    const host = l.host || '-';
                    const atkType = l.attack_type || l.event_id || '-';
                    const risk = l.risk_level || '-';
                    const rule = l.rule_desc || l.rule_id || '-';
                    const riskCls = risk === 'high' ? 'sl-badge-block' : risk === 'medium' ? 'sl-badge-warn' : 'sl-badge-ok';
                    return `<tr>
                        <td style="white-space:nowrap;font-size:0.78rem">${esc(time)}</td>
                        <td>${esc(srcIp)}</td>
                        <td>${esc(host)}</td>
                        <td>${esc(atkType)}</td>
                        <td><span class="sl-badge ${riskCls}">${esc(risk)}</span></td>
                        <td style="font-size:0.78rem;max-width:200px;overflow:hidden;text-overflow:ellipsis" title="${esc(rule)}">${esc(rule)}</td>
                    </tr>`;
                }).join('') + '</tbody></table>';
            renderSLLogPagination(total);
        }).catch(e => { el.innerHTML = '<div class="empty-state">加载失败: ' + esc(e.message) + '</div>'; });
    }

    function renderSLLogPagination(total) {
        const el = document.getElementById('slLogPagination');
        if (total <= slState.logCount) { el.innerHTML = ''; return; }
        const pages = Math.ceil(total / slState.logCount);
        const current = Math.floor(slState.logOffset / slState.logCount);
        let html = '<div class="sl-page-info">共 ' + total + ' 条</div>';
        html += '<div class="sl-page-btns">';
        if (current > 0) html += '<button class="btn btn-secondary btn-sm" onclick="window._slLogPage(0)">首页</button>';
        if (current > 0) html += '<button class="btn btn-secondary btn-sm" onclick="window._slLogPage(' + ((current - 1) * slState.logCount) + ')">上一页</button>';
        html += '<span class="sl-page-cur">' + (current + 1) + ' / ' + pages + '</span>';
        if (current < pages - 1) html += '<button class="btn btn-secondary btn-sm" onclick="window._slLogPage(' + ((current + 1) * slState.logCount) + ')">下一页</button>';
        html += '</div>';
        el.innerHTML = html;
    }

    window._slLogPage = function(offset) {
        slState.logOffset = offset;
        loadSLLogs();
    };

    // ── System Info ──
    function loadSLSystem() {
        const el = document.getElementById('slSystemInfo');
        el.innerHTML = '<div class="empty-state">加载中...</div>';
        Promise.all([slFetch('/system'), slFetch('/license'), slFetch('/nodes')]).then(([sys, license, nodes]) => {
            const hostname = sys.hostname || '-';
            const vendor = sys.vendor || {};
            const lic = license.data || {};
            const nodeInfo = nodes.data || {};

            el.innerHTML = `
                <div class="sl-info-block">
                    <h3>基本信息</h3>
                    <div class="sl-info-row"><span>产品</span><span>${esc(vendor.product_name || '-')}</span></div>
                    <div class="sl-info-row"><span>版本</span><span>${esc(vendor.version || '-')}</span></div>
                    <div class="sl-info-row"><span>主机名</span><span>${esc(typeof hostname === 'string' ? hostname : JSON.stringify(hostname))}</span></div>
                </div>
                <div class="sl-info-block">
                    <h3>许可证</h3>
                    <div class="sl-info-row"><span>授权类型</span><span>${esc(lic.license_type || '-')}</span></div>
                    <div class="sl-info-row"><span>到期时间</span><span>${lic.expired_at ? new Date(lic.expired_at).toLocaleDateString() : '-'}</span></div>
                    <div class="sl-info-row"><span>最大节点</span><span>${esc(lic.max_nodes ?? '-')}</span></div>
                </div>
                <div class="sl-info-block">
                    <h3>节点状态</h3>
                    ${Array.isArray(nodeInfo) ? nodeInfo.map(n => `
                        <div class="sl-info-row"><span>${esc(n.name || n.hostname || '-')}</span><span>${esc(n.status || 'unknown')}</span></div>
                    `).join('') : '<div class="sl-info-row"><span>状态</span><span>' + esc(JSON.stringify(nodeInfo)) + '</span></div>'}
                </div>`;
        }).catch(e => { el.innerHTML = '<div class="empty-state">加载失败: ' + esc(e.message) + '</div>'; });
    }

    function fmtNum(n) {
        if (typeof n !== 'number') return String(n || 0);
        if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
        if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
        return String(n);
    }

    // ── CloudWalker HIDS Management ─────────────────────────────────────────
    const CW = API + '/cloudwalker';
    const cwState = { eventOffset: 0, eventCount: 20 };
    const cwEventTypes = {
        webshell: '木马', revshell: '反弹Shell', malware: '恶意文件',
        brute_force: '暴力破解', honeypot: '蜜罐诱捕',
        elevation_process: '本地提权', abnormal_login: '异常登录'
    };

    function bindCloudWalker() {
        // Config test
        document.getElementById('cwTestBtn').addEventListener('click', () => {
            const url = document.getElementById('cwUrl').value.trim();
            const token = document.getElementById('cwToken').value.trim();
            if (!url || !token) { showToast('请填写 API 地址和 Token', 'error'); return; }
            const st = document.getElementById('cwConfigStatus');
            st.textContent = '测试中...'; st.className = 'sl-config-status';
            fetch(CW + '/test', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url, token }) })
                .then(r => r.json()).then(d => {
                    if (d.error) { st.textContent = '失败: ' + d.error; st.className = 'sl-config-status sl-status-error'; return; }
                    st.textContent = '连接成功'; st.className = 'sl-config-status sl-status-ok';
                }).catch(e => { st.textContent = '请求失败: ' + e.message; st.className = 'sl-config-status sl-status-error'; });
        });
        // Config save
        document.getElementById('cwSaveBtn').addEventListener('click', () => {
            const url = document.getElementById('cwUrl').value.trim();
            const token = document.getElementById('cwToken').value.trim();
            if (!url || !token) { showToast('请填写 API 地址和 Token', 'error'); return; }
            const st = document.getElementById('cwConfigStatus');
            st.textContent = '保存中...'; st.className = 'sl-config-status';
            fetch(CW + '/config', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url, token }) })
                .then(r => r.json()).then(d => {
                    if (d.error) { st.textContent = '失败: ' + d.error; st.className = 'sl-config-status sl-status-error'; return; }
                    st.textContent = '配置已保存'; st.className = 'sl-config-status sl-status-ok';
                    showToast('API 配置已保存', 'success');
                }).catch(e => { st.textContent = '请求失败'; st.className = 'sl-config-status sl-status-error'; });
        });

        // Sub-tabs (reuse .sl-subtab / .sl-panel classes)
        document.querySelectorAll('.sl-subtab[data-sl-tab^="cw-"]').forEach(tab => {
            tab.addEventListener('click', () => {
                document.querySelectorAll('.sl-subtab[data-sl-tab^="cw-"]').forEach(t => t.classList.toggle('active', t.dataset.slTab === tab.dataset.slTab));
                document.querySelectorAll('.sl-panel[id^="cw-"]').forEach(p => p.classList.toggle('active', p.id === tab.dataset.slTab));
            });
        });

        // Overview
        document.getElementById('cwRefreshOverview').addEventListener('click', loadCWOverview);
        document.getElementById('cwDistPeriod').addEventListener('change', loadCWOverview);

        // Events
        document.getElementById('cwRefreshEvents').addEventListener('click', () => { cwState.eventOffset = 0; loadCWEvents(); });
        document.getElementById('cwEventType').addEventListener('change', () => { cwState.eventOffset = 0; loadCWEvents(); });

        // Alerts
        document.getElementById('cwRefreshAlerts').addEventListener('click', loadCWAlerts);
    }

    function loadCloudWalkerConfig() {
        fetch(CW + '/config').then(r => {
            if (!r.ok) throw new Error('加载配置失败: ' + r.status);
            return r.json();
        }).then(cfg => {
            if (cfg.url) document.getElementById('cwUrl').value = cfg.url;
            if (cfg.token) document.getElementById('cwToken').value = cfg.token;
            if (cfg.url && cfg.token) {
                document.getElementById('cwConfigStatus').textContent = '已配置';
                document.getElementById('cwConfigStatus').className = 'sl-config-status sl-status-ok';
            }
        }).catch(err => {
            showToast(err.message, 'error');
        });
    }

    function cwFetch(path) {
        return fetch(CW + path).then(r => {
            if (!r.ok) throw new Error('API 请求失败: ' + r.status);
            return r.json();
        }).then(d => {
            if (d.error) throw new Error(d.error);
            return d;
        }).catch(err => {
            showToast('请求失败: ' + err.message, 'error');
            throw err;
        });
    }

    // ── CW Overview ──
    function loadCWOverview() {
        const period = document.getElementById('cwDistPeriod').value;
        const el = document.getElementById('cwOverviewCards');
        el.innerHTML = '<div class="empty-state">加载中...</div>';
        document.getElementById('cwEventDist').innerHTML = '';
        cwFetch('/overview').then(data => {
            // Real-time events summary
            const rtd = data.real_time_events || {};
            const evtList = rtd.data || rtd.event_list || rtd.events || rtd.items || [];
            const total = rtd.total || evtList.length || 0;
            const cards = [
                { label: '实时事件', value: fmtNum(typeof total === 'number' ? total : 0), color: 'var(--danger)' },
            ];
            // Processed info
            const pdArr = (data.processed_info || {}).data || [];
            const pdRisky = pdArr.find(d => d.state === 'risky') || {};
            const pdProcessed = pdArr.find(d => d.state === 'processed') || {};
            cards.push(
                { label: '待处理', value: fmtNum((pdRisky.low||0)+(pdRisky.medium||0)+(pdRisky.high||0)+(pdRisky.critical||0)), color: '#f59e0b' },
                { label: '已处理', value: fmtNum((pdProcessed.low||0)+(pdProcessed.medium||0)+(pdProcessed.high||0)+(pdProcessed.critical||0)), color: 'var(--success)' }
            );
            el.innerHTML = cards.map(c => `
                <div class="sl-stat-card">
                    <div class="sl-stat-value" style="color:${c.color}">${c.value}</div>
                    <div class="sl-stat-label">${c.label}</div>
                </div>`).join('');

            // Event type distribution
            const distData = ((data.event_dist || {}).data) || [];
            const distEl = document.getElementById('cwEventDist');
            if (Array.isArray(distData) && distData.length > 0) {
                const sorted = [...distData].sort((a, b) => (b.count || 0) - (a.count || 0));
                const maxVal = sorted[0]?.count || 1;
                distEl.innerHTML = '<h3 style="font-size:0.95rem;margin-bottom:10px">事件类型分布</h3><div class="sl-type-grid">' +
                    sorted.map(t => {
                        const name = t.display_name || t.type_name || t.name || '-';
                        const count = t.count || 0;
                        return `<div class="sl-type-row">
                            <span class="sl-type-name">${esc(name)}</span>
                            <div class="sl-type-bar-wrap"><div class="sl-type-bar cw-dist-bar" style="width:${(count / maxVal) * 100}%"></div></div>
                            <span class="sl-type-count">${fmtNum(count)}</span>
                        </div>`;
                    }).join('') + '</div>';
            } else {
                distEl.innerHTML = '';
            }
        }).catch(e => { el.innerHTML = '<div class="empty-state">加载失败: ' + esc(e.message) + '</div>'; });
    }

    // ── CW Events ──
    function loadCWEvents() {
        const type = document.getElementById('cwEventType').value;
        const el = document.getElementById('cwEventList');
        el.innerHTML = '<div class="empty-state">加载中...</div>';
        cwFetch('/events?type=' + type + '&count=' + cwState.eventCount + '&offset=' + cwState.eventOffset).then(data => {
            const items = data.events || data.event_list || data.items || [];
            const total = data.total || items.length || 0;
            if (!items.length) { el.innerHTML = '<div class="empty-state">暂无事件</div>'; renderCWEventPagination(total); return; }
            el.innerHTML = '<table class="sl-table"><thead><tr><th>时间</th><th>主机</th><th>事件类型</th><th>等级</th><th>详情</th></tr></thead><tbody>' +
                items.map(ev => {
                    const time = ev.event_time || ev.create_time || ev.time || '-';
                    const host = ev.host_name || ev.hostname || ev.host_ip || '-';
                    const evtType = ev.event_type || ev.type || type;
                    const level = ev.level || ev.risk_level || '-';
                    const levelCls = level === 'high' || level === '高' ? 'sl-badge-block' : level === 'medium' || level === '中' ? 'sl-badge-warn' : 'sl-badge-ok';
                    const summary = ev.summary || ev.description || ev.detail || '-';
                    const evId = ev.id || ev.event_id || '';
                    return `<tr>
                        <td style="white-space:nowrap;font-size:0.78rem">${esc(typeof time === 'number' ? new Date(time * 1000).toLocaleString() : String(time))}</td>
                        <td>${esc(host)}</td>
                        <td>${esc(cwEventTypes[evtType] || evtType)}</td>
                        <td><span class="sl-badge ${levelCls}">${esc(level)}</span></td>
                        <td style="font-size:0.78rem;max-width:300px;overflow:hidden;text-overflow:ellipsis" title="${esc(String(summary))}">${esc(String(summary).substring(0, 80))}</td>
                    </tr>`;
                }).join('') + '</tbody></table>';
            renderCWEventPagination(total);
        }).catch(e => { el.innerHTML = '<div class="empty-state">加载失败: ' + esc(e.message) + '</div>'; });
    }

    function renderCWEventPagination(total) {
        const el = document.getElementById('cwEventPagination');
        if (total <= cwState.eventCount) { el.innerHTML = ''; return; }
        const pages = Math.ceil(total / cwState.eventCount);
        const current = Math.floor(cwState.eventOffset / cwState.eventCount);
        let html = '<div class="sl-page-info">共 ' + total + ' 条</div><div class="sl-page-btns">';
        if (current > 0) html += '<button class="btn btn-secondary btn-sm" onclick="window._cwEventPage(0)">首页</button>';
        if (current > 0) html += '<button class="btn btn-secondary btn-sm" onclick="window._cwEventPage(' + ((current - 1) * cwState.eventCount) + ')">上一页</button>';
        html += '<span class="sl-page-cur">' + (current + 1) + ' / ' + pages + '</span>';
        if (current < pages - 1) html += '<button class="btn btn-secondary btn-sm" onclick="window._cwEventPage(' + ((current + 1) * cwState.eventCount) + ')">下一页</button>';
        html += '</div>';
        el.innerHTML = html;
    }

    window._cwEventPage = function(offset) {
        cwState.eventOffset = offset;
        loadCWEvents();
    };

    // ── CW Alerts ──
    function loadCWAlerts() {
        const el = document.getElementById('cwAlertList');
        el.innerHTML = '<div class="empty-state">加载中...</div>';
        cwFetch('/alerts').then(data => {
            const items = data.configs || data.alert_list || data.alerts || data.items || [];
            if (!items.length) { el.innerHTML = '<div class="empty-state">暂无告警配置</div>'; return; }
            el.innerHTML = '<table class="sl-table"><thead><tr><th>名称</th><th>类型</th><th>状态</th><th>描述</th></tr></thead><tbody>' +
                items.map(a => {
                    const name = a.name || a.alert_name || '-';
                    const type = a.type || a.alert_type || '-';
                    const enabled = a.is_enabled !== false && a.enabled !== false;
                    return `<tr>
                        <td><strong>${esc(name)}</strong></td>
                        <td>${esc(type)}</td>
                        <td><span class="sl-badge ${enabled ? 'sl-badge-ok' : 'sl-badge-off'}">${enabled ? '启用' : '禁用'}</span></td>
                        <td style="font-size:0.82rem">${esc(a.description || a.remark || '-')}</td>
                    </tr>`;
                }).join('') + '</tbody></table>';
        }).catch(e => { el.innerHTML = '<div class="empty-state">加载失败: ' + esc(e.message) + '</div>'; });
    }

    // ── Threat Intelligence ──────────────────────────────────────────────────
    function tiHeaders() {
        const cfg = JSON.parse(localStorage.getItem('cve_settings') || '{}');
        return {
            'Content-Type': 'application/json',
            'X-API-URL': cfg.apiUrl || '',
            'X-API-Key': cfg.apiKey || '',
            'X-Model': cfg.model || ''
        };
    }

    function bindThreatIntel() {
        // Auto-detect UI hidden; CVE lookup is the primary interface
    }

    function dismissTIBanner() {
        const banner = document.getElementById('tiBanner');
        banner.style.display = 'none';
        fetch(API + '/threatintel/dismiss', { method: 'POST', headers: tiHeaders() }).catch(() => {});
    }

    function dismissTI(id) {
        // dismissed directly without confirm
        fetch(API + '/threatintel/dismiss', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: id })
        }).then(function() {
            loadTIThreats();
            loadTIStatus();
        }).catch(function() {});
    }

    function lookupCVE() {
        const input = document.getElementById('tiCveInput');
        const cveID = input.value.trim().toUpperCase();
        if (!cveID) return;
        if (!cveID.startsWith('CVE-')) {
            alert('CVE 编号格式错误，应以 CVE- 开头');
            return;
        }
        const btn = document.getElementById('tiLookupBtn');
        const el = document.getElementById('tiThreatList');
        btn.disabled = true;
        btn.textContent = '查询中...';
        el.innerHTML = '<div class="empty-state">正在从 NVD 查询 ' + esc(cveID) + ' ...</div>';

        fetch(API + '/threatintel/lookup-cve', {
            method: 'POST',
            headers: Object.assign({ 'Content-Type': 'application/json' }, tiHeaders()),
            body: JSON.stringify({ cve_id: cveID })
        })
        .then(r => r.json())
        .then(data => {
            if (data.status === 'not_found') {
                el.innerHTML = '<div class="empty-state">NVD 中未找到 ' + esc(cveID) + '，该 CVE 可能尚未被 NVD 收录</div>';
                return;
            }
            if (data.error) {
                el.innerHTML = '<div class="empty-state">查询失败: ' + esc(data.error) + '</div>';
                return;
            }
            // Get the threat item
            const items = data.items || (data.item ? [data.item] : []);
            if (!items.length) {
                el.innerHTML = '<div class="empty-state">未找到漏洞信息</div>';
                return;
            }
            const t = items[0];
            // Auto-analyze
            el.innerHTML = '<div class="empty-state">已找到 ' + esc(t.title) + '，正在分析是否影响当前环境...</div>';
            fetch(API + '/threatintel/analyze/' + t.id, { method: 'POST', headers: tiHeaders() })
                .then(r => r.json())
                .then(result => {
                    if (result.error) {
                        renderCVEDetail(t, { affected: false, reason: '分析失败: ' + result.error });
                        return;
                    }
                    if (result.status === 'already_analyzed') {
                        // Fetch existing result
                        return fetch(API + '/threatintel/results', { headers: tiHeaders() })
                            .then(r => r.json())
                            .then(results => {
                                const existing = results[t.id];
                                if (existing && existing.error) {
                                    renderCVEDetail(t, { affected: false, reason: '分析失败: ' + existing.error });
                                    return null;
                                }
                                return existing || result;
                            });
                    }
                    return result;
                })
                .then(result => {
                    if (result) renderCVEDetail(t, result);
                })
                .catch(e => {
                    renderCVEDetail(t, { affected: false, reason: '分析失败: ' + e.message });
                });
        })
        .catch(err => {
            el.innerHTML = '<div class="empty-state">查询失败: ' + esc(err.message) + '</div>';
        })
        .finally(() => { btn.disabled = false; btn.textContent = '查询并分析'; });
    }

    function renderCVEDetail(t, r) {
        _tiCurrentThreat = t;
        const el = document.getElementById('tiThreatList');
        const sevClass = t.severity === 'critical' ? 'ti-sev-critical' : t.severity === 'high' ? 'ti-sev-high' : t.severity === 'medium' ? 'ti-sev-medium' : 'ti-sev-low';
        const sevLabel = t.severity === 'critical' ? '严重' : t.severity === 'high' ? '高危' : t.severity === 'medium' ? '中危' : '低危';

        let html = '<div class="cve-detail">';
        html += '<div class="cve-detail-header">';
        html += '<a href="' + esc(t.url) + '" target="_blank" class="cve-detail-title">' + esc(t.title) + '</a>';
        html += '<span class="' + sevClass + '" style="margin-left:8px">' + sevLabel + '</span>';
        html += '</div>';
        html += '<div class="cve-detail-meta">来源: ' + esc(t.source) + ' | 发布: ' + esc(t.published_at || '') + '</div>';

        if (r.affected) {
            html += '<div class="cve-affected"><strong>该漏洞影响当前环境</strong></div>';
        } else {
            html += '<div class="cve-safe"><strong>该漏洞不影响当前环境</strong></div>';
        }

        if (r.reason) {
            html += '<div class="cve-section"><div class="cve-section-title">影响分析</div><div class="cve-section-body">' + esc(r.reason) + '</div></div>';
        }
        if (r.vuln_principle) {
            html += '<div class="cve-section"><div class="cve-section-title">漏洞原理</div><div class="cve-section-body">' + esc(r.vuln_principle) + '</div></div>';
        }
        if (r.vuln_detail) {
            html += '<div class="cve-section"><div class="cve-section-title">技术细节</div><div class="cve-section-body">' + esc(r.vuln_detail) + '</div></div>';
        }
        if (r.affected && r.affected_hosts && r.affected_hosts.length > 0) {
            html += '<div class="cve-section"><div class="cve-section-title">受影响主机</div><div class="cve-section-body">' + r.affected_hosts.map(h => '<span class="ti-host-tag">' + esc(h) + '</span>').join(' ') + '</div></div>';
        }
        if (r.affected && r.solution) {
            html += '<div class="cve-section cve-solution"><div class="cve-section-title">修复方案</div><div class="cve-section-body">' + esc(r.solution) + '</div></div>';
        }
        if (r.analyzed_at) {
            html += '<div class="cve-detail-meta" style="margin-top:12px">分析时间: ' + esc(r.analyzed_at) + '</div>';
        }
        if (r.affected && r.solution) {
            html += '<div style="margin-top:16px"><button class="btn btn-warning" onclick="tiAutoFix(\'' + esc(t.id) + '\')">自动修复</button></div>';
        }
        html += '</div>';
        el.innerHTML = html;
    }

    function locateAndShowTI(id) {
        var rows = document.querySelectorAll('#tiThreatList tr');
        var found = false;
        rows.forEach(function(row) {
            if (found) return;
            var link = row.querySelector('a[href*="' + id + '"]');
            var btn = row.querySelector('[onclick*="showTIAnalysis(\'' + id + '\')"]');
            var cell = row.querySelector('.ti-title');
            if (cell && cell.textContent.indexOf(id.split('-').pop()) !== -1) {
                found = true;
                row.scrollIntoView({ behavior: 'smooth', block: 'center' });
                row.style.background = '#fef3c7';
                setTimeout(function() { row.style.background = ''; }, 3000);
                showTIAnalysis(id);
            }
        });
    }

    function loadTIStatus() {
        fetch(API + '/threatintel/status')
            .then(r => r.json())
            .then(data => {
                document.getElementById('tiLastFetch').textContent = data.last_fetch ? new Date(data.last_fetch).toLocaleString() : '-';
                document.getElementById('tiTotalCount').textContent = data.total || 0;
                document.getElementById('tiAnalyzedCount').textContent = data.analyzed || 0;
                document.getElementById('tiAffectedCount').textContent = data.affected || 0;
                const statusText = document.getElementById('tiStatusText');
                if (data.total > 0) {
                    statusText.textContent = '已检测';
                    statusText.className = 'ti-status-text ti-status-safe';
                }
                // Badge
                const badge = document.getElementById('tiBadge');
                const unread = data.unread_affected_count || 0;
                if (unread > 0) {
                    badge.style.display = 'inline';
                    badge.textContent = unread > 99 ? '99+' : unread;
                    badge.className = 'ti-badge ti-badge-danger';
                    const banner = document.getElementById('tiBanner');
                    banner.style.display = 'flex';
                    document.getElementById('tiBannerText').textContent =
                        '发现 ' + unread + ' 个可能影响您环境的CVE漏洞，请前往威胁情报页面查看。';
                } else {
                    badge.style.display = 'none';
                }
                // Show/hide reanalyze-all button
                const reanalyzeBtn = document.getElementById('tiReanalyzeAllBtn');
                reanalyzeBtn.style.display = data.analyzed > 0 ? 'inline-block' : 'none';
            })
            .catch(() => {});
    }

    function fetchTIThreats() {
        const btn = document.getElementById('tiFetchBtn');
        btn.disabled = true;
        btn.textContent = '检测中...';
        document.getElementById('tiThreatList').innerHTML = '<div class="ti-analyzing"><div class="ti-analyzing-spinner"></div>正在从 NVD 查询相关 CVE 漏洞，请稍候（可能需要1-2分钟）...</div>';
        fetch(API + '/threatintel/fetch', { method: 'POST', headers: tiHeaders() })
            .then(r => r.json())
            .then(data => {
                if (data.error) {
                    document.getElementById('tiThreatList').innerHTML = '<div class="ti-error">检测失败: ' + esc(data.error) + '</div>';
                    btn.disabled = false;
                    btn.textContent = '立即检测';
                    return;
                }
                // 轮询等待后台完成
                const startTime = Date.now();
                const poll = setInterval(() => {
                    fetch(API + '/threatintel/status').then(r => r.json()).then(status => {
                        // 完成条件：有last_fetch且fetch在我们触发之后
                        if (status.last_fetch) {
                            clearInterval(poll);
                            btn.disabled = false;
                            btn.textContent = '立即检测';
                            loadTIThreats();
                            loadTIStatus();
                        }
                    }).catch(() => {});
                }, 5000);
                // 安全超时：3分钟后停止轮询
                setTimeout(() => { clearInterval(poll); btn.disabled = false; btn.textContent = '立即检测'; loadTIThreats(); loadTIStatus(); }, 180000);
            })
            .catch(e => {
                document.getElementById('tiThreatList').innerHTML = '<div class="ti-error">检测失败: ' + esc(e.message) + '</div>';
                btn.disabled = false;
                btn.textContent = '立即检测';
            });
    }

    function loadTIThreats() {
        return Promise.all([
            fetch(API + '/threatintel/threats').then(r => r.json()),
            fetch(API + '/threatintel/results').then(r => r.json())
        ]).then(([threats, results]) => {
            renderTIThreats(threats, results);
        }).catch(e => {
            document.getElementById('tiThreatList').innerHTML = '<div class="ti-error">加载失败: ' + esc(e.message) + '</div>';
        });
    }

    function renderTIThreats(threats, results) {
        const el = document.getElementById('tiThreatList');
        if (!threats || threats.length === 0) {
            el.innerHTML = '<div class="empty-state">暂无威胁情报数据</div>';
            return;
        }
        let html = '<table class="sl-table"><thead><tr><th>标题</th><th>来源</th><th>严重程度</th><th>状态</th><th>操作</th></tr></thead><tbody>';
        threats.forEach(t => {
            const r = results[t.id];
            const sevClass = t.severity === 'critical' ? 'ti-sev-critical' : t.severity === 'high' ? 'ti-sev-high' : t.severity === 'medium' ? 'ti-sev-medium' : 'ti-sev-low';
            let statusHTML = '<span class="ti-status-pending">未分析</span>';
            let actionsHTML = '<button class="btn btn-primary btn-xs" onclick="analyzeTIThreat(\'' + esc(t.id) + '\')">分析</button>';
            const dismissBtn = '<button class="btn btn-outline btn-xs" onclick="dismissTI(\'' + esc(t.id) + '\')" style="color:#94a3b8">不相关</button>';
            if (r) {
                if (r.affected) {
                    const hostsStr = (r.affected_hosts || []).map(h => '<span class="ti-host-tag">' + esc(h) + '</span>').join(' ');
                    statusHTML = '<span class="ti-status-affected">影响环境</span>' + (hostsStr ? '<br><span class="ti-affected-hosts">' + hostsStr + '</span>' : '');
                    actionsHTML = '<button class="btn btn-secondary btn-xs" onclick="showTIAnalysis(\'' + esc(t.id) + '\')">详情</button> ' +
                        '<button class="btn btn-secondary btn-xs" onclick="tiReanalyze(\'' + esc(t.id) + '\')">重新分析</button> ' +
                        '<button class="btn btn-warning btn-xs" onclick="tiAutoFix(\'' + esc(t.id) + '\')">自动修复</button>';
                } else {
                    statusHTML = '<span class="ti-status-safe">不涉及</span>';
                    actionsHTML = '<button class="btn btn-secondary btn-xs" onclick="showTIAnalysis(\'' + esc(t.id) + '\')">详情</button> ' +
                        '<button class="btn btn-outline btn-xs" onclick="dismissTI(\'' + esc(t.id) + '\')" style="color:#94a3b8;border-color:#94a3b8">标记不相关</button>';
                }
            }
            actionsHTML += ' ' + dismissBtn;
            html += '<tr class="' + (r && r.affected ? 'ti-row-affected' : '') + '">' +
                '<td class="ti-title"><a href="' + esc(t.url) + '" target="_blank" class="ti-link">' + esc(t.title) + '</a></td>' +
                '<td>' + esc(t.source) + '</td>' +
                '<td><span class="' + sevClass + '">' + esc(t.severity) + '</span></td>' +
                '<td>' + statusHTML + '</td>' +
                '<td style="white-space:nowrap">' + actionsHTML + '</td></tr>';
        });
        html += '</tbody></table>';
        el.innerHTML = html;
    }

    function renderTIResultHTML(r) {
        if (!r) return '';
        let html = '<div class="ti-analysis-row">';
        if (r.affected) {
            html += '<div class="ti-result-affected"><strong>该漏洞影响当前环境</strong></div>';
            if (r.reason) html += '<div class="ti-result-reason">' + esc(r.reason) + '</div>';
            if (r.affected_hosts && r.affected_hosts.length > 0) {
                html += '<div class="ti-result-hosts"><strong>受影响主机：</strong>' + r.affected_hosts.map(h => '<span class="ti-host-tag">' + esc(h) + '</span>').join(' ') + '</div>';
            }
        } else {
            html += '<div class="ti-result-safe"><strong>该漏洞不影响当前环境</strong></div>';
            if (r.reason) html += '<div class="ti-result-reason">' + esc(r.reason) + '</div>';
        }
        if (r.vuln_principle) html += '<div class="ti-result-section"><div class="ti-result-label">漏洞原理</div><div class="ti-result-value">' + esc(r.vuln_principle).replace(/\n/g, '<br>') + '</div></div>';
        if (r.vuln_detail) html += '<div class="ti-result-section"><div class="ti-result-label">技术细节</div><div class="ti-result-value">' + esc(r.vuln_detail).replace(/\n/g, '<br>') + '</div></div>';
        if (r.solution) html += '<div class="ti-result-section ti-result-solution-section"><div class="ti-result-label">修复方案</div><div class="ti-result-value">' + esc(r.solution).replace(/\n/g, '<br>') + '</div></div>';
        if (r.analyzed_at) html += '<div class="ti-result-time">分析时间: ' + esc(r.analyzed_at) + '</div>';
        html += '</div>';
        return html;
    }

    function showTIAnalysis(id) {
        const rows = document.querySelectorAll('#tiThreatList tr');
        rows.forEach(row => {
            const btn = row.querySelector('[onclick*="showTIAnalysis(\'' + id + '\')"]');
            if (btn) {
                const nextRow = row.nextElementSibling;
                if (nextRow && nextRow.classList.contains('ti-detail-row')) {
                    nextRow.remove();
                    return;
                }
                fetch(API + '/threatintel/results')
                    .then(r => r.json())
                    .then(results => {
                        const r = results[id];
                        if (!r) return;
                        const detailRow = document.createElement('tr');
                        detailRow.className = 'ti-detail-row';
                        const detailCell = document.createElement('td');
                        detailCell.colSpan = 5;
                        detailCell.innerHTML = renderTIResultHTML(r);
                        detailRow.appendChild(detailCell);
                        row.after(detailRow);
                    });
            }
        });
    }

    function analyzeTIThreat(id) {
        const rows = document.querySelectorAll('#tiThreatList tr');
        rows.forEach(row => {
            const btn = row.querySelector('[onclick*="analyzeTIThreat(\'' + id + '\')"]');
            if (btn) {
                btn.disabled = true;
                btn.textContent = '分析中...';
                fetch(API + '/threatintel/analyze/' + id, { method: 'POST', headers: tiHeaders() })
                    .then(r => r.json())
                    .then(data => {
                        if (data.status === 'already_analyzed') {
                            // Re-render the row from status
                            loadTIThreats();
                            return;
                        }
                        if (data.error) {
                            btn.disabled = false;
                            btn.textContent = '分析';
                            alert('分析失败: ' + data.error);
                            return;
                        }
                        // Show result inline as detail row
                        let detailRow = row.nextElementSibling;
                        if (!detailRow || !detailRow.classList.contains('ti-detail-row')) {
                            detailRow = document.createElement('tr');
                            detailRow.className = 'ti-detail-row';
                            const detailCell = document.createElement('td');
                            detailCell.colSpan = 5;
                            detailRow.appendChild(detailCell);
                            row.after(detailRow);
                        }
                        detailRow.querySelector('td').innerHTML = renderTIResultHTML(data);
                        // Update the status column
                        const statusTd = row.children[3];
                        if (data.affected) {
                            const hostsStr = (data.affected_hosts || []).map(h => '<span class="ti-host-tag">' + esc(h) + '</span>').join(' ');
                            statusTd.innerHTML = '<span class="ti-status-affected">影响环境</span>' + (hostsStr ? '<br><span class="ti-affected-hosts">' + hostsStr + '</span>' : '');
                            row.className = 'ti-row-affected';
                        } else {
                            statusTd.innerHTML = '<span class="ti-status-safe">不涉及</span>';
                        }
                        // Update action buttons
                        const actionTd = row.children[4];
                        const dismissBtn = !data.affected ? ' <button class="btn btn-outline btn-xs" onclick="dismissTI(\'' + esc(id) + '\')" style="color:#94a3b8;border-color:#94a3b8">标记不相关</button>' : '';
                        actionTd.innerHTML = '<button class="btn btn-secondary btn-xs" onclick="showTIAnalysis(\'' + esc(id) + '\')">详情</button> ' +
                            (data.affected ? '<button class="btn btn-secondary btn-xs" onclick="tiReanalyze(\'' + esc(id) + '\')">重新分析</button> <button class="btn btn-warning btn-xs" onclick="tiAutoFix(\'' + esc(id) + '\')">自动修复</button>' : dismissBtn);
                        // BUG FIX: Only call loadTIStatus, NOT loadTIThreats
                        loadTIStatus();
                    })
                    .catch(e => {
                        btn.disabled = false;
                        btn.textContent = '分析';
                        alert('分析失败: ' + e.message);
                    });
            }
        });
    }

    function tiReanalyze(id) {
        const rows = document.querySelectorAll('#tiThreatList tr');
        rows.forEach(row => {
            const btn = row.querySelector('[onclick*="tiReanalyze(\'' + id + '\')"]');
            if (btn) {
                btn.disabled = true;
                btn.textContent = '分析中...';
                fetch(API + '/threatintel/analyze/' + id + '?force=true', { method: 'POST', headers: tiHeaders() })
                    .then(r => r.json())
                    .then(data => {
                        if (data.error) {
                            btn.disabled = false;
                            btn.textContent = '重新分析';
                            alert('分析失败: ' + data.error);
                            return;
                        }
                        // Show result inline
                        let detailRow = row.nextElementSibling;
                        if (!detailRow || !detailRow.classList.contains('ti-detail-row')) {
                            detailRow = document.createElement('tr');
                            detailRow.className = 'ti-detail-row';
                            const detailCell = document.createElement('td');
                            detailCell.colSpan = 5;
                            detailRow.appendChild(detailCell);
                            row.after(detailRow);
                        }
                        detailRow.querySelector('td').innerHTML = renderTIResultHTML(data);
                        const statusTd = row.children[3];
                        if (data.affected) {
                            const hostsStr = (data.affected_hosts || []).map(h => '<span class="ti-host-tag">' + esc(h) + '</span>').join(' ');
                            statusTd.innerHTML = '<span class="ti-status-affected">影响环境</span>' + (hostsStr ? '<br><span class="ti-affected-hosts">' + hostsStr + '</span>' : '');
                            row.className = 'ti-row-affected';
                        } else {
                            statusTd.innerHTML = '<span class="ti-status-safe">不涉及</span>';
                        }
                        const actionTd = row.children[4];
                        const dismissBtn2 = !data.affected ? ' <button class="btn btn-outline btn-xs" onclick="dismissTI(\'' + esc(id) + '\')" style="color:#94a3b8;border-color:#94a3b8">标记不相关</button>' : '';
                        actionTd.innerHTML = '<button class="btn btn-secondary btn-xs" onclick="showTIAnalysis(\'' + esc(id) + '\')">详情</button> ' +
                            (data.affected ? '<button class="btn btn-secondary btn-xs" onclick="tiReanalyze(\'' + esc(id) + '\')">重新分析</button> <button class="btn btn-warning btn-xs" onclick="tiAutoFix(\'' + esc(id) + '\')">自动修复</button>' : dismissBtn2);
                        loadTIStatus();
                    })
                    .catch(e => {
                        btn.disabled = false;
                        btn.textContent = '重新分析';
                        alert('分析失败: ' + e.message);
                    });
            }
        });
    }

    function analyzeTIAll() {
        const btn = document.getElementById('tiAnalyzeAllBtn');
        btn.disabled = true;
        btn.textContent = '分析中...';
        fetch(API + '/threatintel/analyze-all', { method: 'POST', headers: tiHeaders() })
            .then(r => r.json())
            .then(data => {
                if (data.error) {
                    alert('分析失败: ' + data.error);
                    btn.disabled = false;
                    btn.textContent = '全部分析';
                    return;
                }
                const count = data.count || 0;
                btn.textContent = '分析中(' + count + ')...';
                let pollCount = 0;
                const poll = setInterval(() => {
                    pollCount++;
                    loadTIStatus();
                    loadTIThreats();
                    fetch(API + '/threatintel/status').then(r => r.json()).then(s => {
                        if (s.analyzed >= count || pollCount > count * 15) {
                            clearInterval(poll);
                            btn.disabled = false;
                            btn.textContent = '全部分析';
                        }
                    });
                }, 3000);
            })
            .catch(e => { alert('分析失败: ' + e.message); btn.disabled = false; btn.textContent = '全部分析'; });
    }

    function reanalyzeTIAll() {
        if (!confirm('确定要清除所有分析结果并重新分析吗？')) return;
        const btn = document.getElementById('tiReanalyzeAllBtn');
        btn.disabled = true;
        btn.textContent = '分析中...';
        fetch(API + '/threatintel/reanalyze-all', { method: 'POST', headers: tiHeaders() })
            .then(r => r.json())
            .then(data => {
                if (data.error) {
                    alert('重新分析失败: ' + data.error);
                    btn.disabled = false;
                    btn.textContent = '全部重新分析';
                    return;
                }
                const count = data.count || 0;
                btn.textContent = '分析中(' + count + ')...';
                let pollCount = 0;
                const poll = setInterval(() => {
                    pollCount++;
                    loadTIStatus();
                    loadTIThreats();
                    fetch(API + '/threatintel/status').then(r => r.json()).then(s => {
                        if (s.analyzed >= count || pollCount > count * 15) {
                            clearInterval(poll);
                            btn.disabled = false;
                            btn.textContent = '全部重新分析';
                        }
                    });
                }, 3000);
            })
            .catch(e => { alert('重新分析失败: ' + e.message); btn.disabled = false; btn.textContent = '全部重新分析'; });
    }

    function tiAutoFix(id) {
        if (!confirm('将使用AI生成修复命令并评估对当前环境的影响，是否继续？')) return;
        // Find the button in the CVE detail div
        const el = document.getElementById('tiThreatList');
        const btn = el.querySelector('[onclick*="tiAutoFix(\'' + id + '\')"]');
        if (btn) { btn.disabled = true; btn.textContent = '评估中...'; }
        // Show loading indicator
        let resultDiv = el.querySelector('.ti-fix-result');
        if (!resultDiv) {
            resultDiv = document.createElement('div');
            resultDiv.className = 'ti-fix-result cve-section';
            const lastSection = el.querySelector('.cve-detail');
            if (lastSection) lastSection.appendChild(resultDiv);
            else el.appendChild(resultDiv);
        }
        resultDiv.innerHTML = '<div class="cve-section-title">修复评估</div><div class="cve-section-body" style="color:var(--text-muted)">正在评估修复方案，请稍候...</div>';
        fetch(API + '/threatintel/fix/' + id, { method: 'POST', headers: tiHeaders() })
            .then(r => r.json())
            .then(data => {
                if (data.error) {
                    let errHtml = '<div class="cve-section-title">修复评估</div><div class="cve-section-body" style="color:#dc2626">评估失败: ' + esc(data.error) + '</div>';
                    if (data.raw_response) {
                        errHtml += '<div class="cve-section-body" style="margin-top:8px"><details><summary style="cursor:pointer;color:var(--text-muted)">查看AI原始响应</summary><pre style="background:var(--surface);padding:8px;border-radius:4px;overflow-x:auto;font-size:0.8rem;margin-top:4px;max-height:300px;overflow-y:auto">' + esc(data.raw_response) + '</pre></details></div>';
                    }
                    if (data.raw) {
                        errHtml += '<div class="cve-section-body" style="margin-top:8px"><details><summary style="cursor:pointer;color:var(--text-muted)">查看AI原始返回</summary><pre style="background:var(--surface);padding:8px;border-radius:4px;overflow-x:auto;font-size:0.8rem;margin-top:4px">' + esc(data.raw) + '</pre></details></div>';
                    }
                    resultDiv.innerHTML = errHtml;
                    if (btn) { btn.disabled = false; btn.textContent = '自动修复'; }
                    return;
                }
                let html = '<div class="cve-section-title">修复评估</div><div class="cve-section-body">';
                if (data.safe) {
                    html += '<div class="ti-result-safe"><strong>评估结果：可以安全执行修复</strong></div>';
                } else {
                    html += '<div class="ti-result-warning"><strong>评估结果：修复命令可能影响当前环境</strong></div>';
                }
                html += '<div style="margin-top:8px">' + esc(data.reason) + '</div>';
                if (data.warning) {
                    html += '<div style="margin-top:8px;color:#d97706">' + esc(data.warning) + '</div>';
                }
                if (data.target_hosts && data.target_hosts.length > 0) {
                    html += '<div style="margin-top:8px"><strong>目标主机：</strong>' +
                        data.target_hosts.map(h => '<span class="ti-host-tag">' + esc(h) + '</span>').join(' ') + '</div>';
                }
                if (data.commands && data.commands.length > 0) {
                    html += '<div style="margin-top:12px"><strong>建议修复命令：</strong><pre class="ti-fix-results" style="background:var(--surface);padding:12px;border-radius:6px;overflow-x:auto">' +
                        data.commands.map(c => esc(c)).join('\n') + '</pre></div>';
                }
                html += '<div style="margin-top:16px"><button class="btn btn-primary" id="tiChatFixBtn">通过AI对话执行修复</button></div>';
                html += '</div>';
                resultDiv.innerHTML = html;
                if (btn) { btn.disabled = false; btn.textContent = '自动修复'; }
                // Bind chat fix button
                const chatBtn = resultDiv.querySelector('#tiChatFixBtn');
                if (chatBtn) {
                    chatBtn.addEventListener('click', () => {
                        // Switch to AI chat tab
                        document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === 'chat'));
                        document.querySelectorAll('.tab-content').forEach(s => s.classList.toggle('active', s.id === 'tab-chat'));
                        state.currentTab = 'chat';
                        const chatHostSel = document.getElementById('chatHostSelect');
                        // Set host selector to first target host if possible
                        if (chatHostSel && data.target_hosts && data.target_hosts.length > 0) {
                            const allHosts = state.hosts;
                            for (const th of data.target_hosts) {
                                const match = allHosts.find(h => h.name === th || h.IP === th);
                                if (match) { chatHostSel.value = match.id; updateChatContextHint(); break; }
                            }
                        }
                        // Build a concise prompt for AI
                        let msg = `帮我修复CVE漏洞：${_tiCurrentThreat ? _tiCurrentThreat.title : id}\n`;
                        if (data.reason) msg += `评估：${data.reason}\n`;
                        if (data.warning) msg += `注意：${data.warning}\n`;
                        if (data.commands && data.commands.length > 0) {
                            msg += `建议执行：\n${data.commands.map(c => c).join('\n')}\n`;
                            msg += `请在目标主机上执行以上命令并验证结果。`;
                        } else {
                            msg += `请给出修复方案并在目标主机上执行。`;
                        }
                        const chatInput = document.getElementById('chatInput');
                        chatInput.value = '';
                        chatInput.focus();
                        sendChatMsg(msg);
                    });
                }
            })
            .catch(e => {
                resultDiv.innerHTML = '<div class="cve-section-title">修复评估</div><div class="cve-section-body" style="color:#dc2626">评估失败: ' + esc(e.message) + '</div>';
                if (btn) { btn.disabled = false; btn.textContent = '自动修复'; }
            });
    }

    // Make functions globally accessible for inline onclick handlers
    window.analyzeTIThreat = analyzeTIThreat;
    window.showTIAnalysis = showTIAnalysis;
    window.tiReanalyze = tiReanalyze;
    window.tiAutoFix = tiAutoFix;
    window.lookupCVE = lookupCVE;
    window.dismissTI = dismissTI;
    window.analyzeTIAll = analyzeTIAll;
    window.reanalyzeTIAll = reanalyzeTIAll;
})();

