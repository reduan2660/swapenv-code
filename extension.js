const vscode = require('vscode');
const { exec } = require('child_process');

let statusBarItem;
let state = { project: null, env: null, envs: [] };

function getCwd() {
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
}

function getConfig(key) {
  return vscode.workspace.getConfiguration('swapenv').get(key);
}

function notify(msg) {
  if (getConfig('showNotifications')) {
    vscode.window.showInformationMessage(msg);
  }
}

function runCmd(cmd, cwd) {
  return new Promise((resolve) => {
    exec(`swapenv ${cmd}`, { cwd }, (err, stdout) => {
      resolve(err ? null : stdout.trim());
    });
  });
}

async function refresh() {
  const cwd = getCwd();
  if (!cwd) {
    state = { project: null, env: null, envs: [] };
    statusBarItem.hide();
    return;
  }

  const info = await runCmd('info --format json', cwd);
  if (!info) {
    state.project = null;
    statusBarItem.hide();
    return;
  }

  try {
    const p = JSON.parse(info);
    state.project = p.project || p.name || true;
    state.env = p.environment || p.env || null;
    state.envs = p.envs || [];
  } catch {
    state.project = null;
    statusBarItem.hide();
    return;
  }

  updateStatusBar();
}

function updateStatusBar() {
  if (!state.project) {
    statusBarItem.hide();
    return;
  }
  statusBarItem.text = `$(plug) ${state.env || 'no env'}`;
  statusBarItem.show();
}

async function showMenu() {
  const items = [];

  if (state.envs.length) {
    items.push({ label: 'to...', kind: vscode.QuickPickItemKind.Separator });
    for (const env of state.envs) {
      const current = env === state.env;
      items.push({
        label: `${current ? '✓' : '   '} ${env}`,
        description: current ? '(current)' : '',
        action: 'switch', env
      });
    }
  }

  items.push({ label: 'Load', kind: vscode.QuickPickItemKind.Separator });
  items.push({ label: 'Load (merge)', action: 'load' });
  items.push({ label: 'Load (replace)', action: 'load-replace' });

  items.push({ label: 'Spit', kind: vscode.QuickPickItemKind.Separator });
  items.push({ label: 'Spit (all)', action: 'spit' });
  items.push({ label: 'Spit (current)', action: 'spit-current' });

  items.push({ label: 'Utility', kind: vscode.QuickPickItemKind.Separator });
  items.push({ label: 'Refresh', action: 'refresh' });
  items.push({ label: 'Versions...', action: 'versions' });

  const picked = await vscode.window.showQuickPick(items, { placeHolder: 'swapenv' });
  if (!picked?.action) return;

  const cwd = getCwd();
  if (!cwd) return;

  switch (picked.action) {
    case 'switch':
      await runCmd(`to ${picked.env}`, cwd);
      notify(`Switched to ${picked.env}`);
      break;
    case 'load':
      await runCmd('load', cwd);
      notify('Loaded (merge)');
      break;
    case 'load-replace':
      await runCmd('load --replace', cwd);
      notify('Loaded (replace)');
      break;
    case 'spit':
      await runCmd('spit', cwd);
      notify('Spit all');
      break;
    case 'spit-current':
      if (state.env) {
        await runCmd(`spit --env ${state.env}`, cwd);
        notify(`Spit ${state.env}`);
      }
      break;
    case 'refresh':
      break;
    case 'versions':
      await showVersions();
      return;
  }

  await refresh();
}

async function showVersions() {
  const cwd = getCwd();
  if (!cwd) return;

  const output = await runCmd('version ls', cwd);
  if (!output) {
    vscode.window.showWarningMessage('No versions found');
    return;
  }

  const versions = output.split('\n').filter(Boolean);
  const items = versions.map((v, i) => ({
    label: i === 0 ? `* ${v} [latest]` : `  ${v}`,
    version: v.replace(/^[\s*]+/, '').trim()
  }));

  const picked = await vscode.window.showQuickPick(items, { placeHolder: 'Switch to version...' });
  if (!picked) return;

  await runCmd(`version ${picked.version}`, cwd);
  notify(`Switched to version ${picked.version}`);
  await refresh();
}

async function switchEnv() {
  const cwd = getCwd();
  if (!cwd) return;
  if (!state.envs.length) await refresh();

  const items = state.envs.map(env => ({
    label: env,
    description: env === state.env ? '(current)' : ''
  }));

  const picked = await vscode.window.showQuickPick(items, { placeHolder: 'Switch to environment...' });
  if (!picked) return;

  await runCmd(`to ${picked.label}`, cwd);
  notify(`Switched to ${picked.label}`);
  await refresh();
}

async function loadCmd() {
  const items = [
    { label: 'Load (merge)', action: 'load' },
    { label: 'Load (replace)', action: 'load-replace' }
  ];
  const picked = await vscode.window.showQuickPick(items, { placeHolder: 'Load environment...' });
  if (!picked) return;

  const cwd = getCwd();
  if (!cwd) return;

  if (picked.action === 'load') {
    await runCmd('load', cwd);
    notify('Loaded (merge)');
  } else {
    await runCmd('load --replace', cwd);
    notify('Loaded (replace)');
  }
  await refresh();
}

async function spitCmd() {
  const items = [
    { label: 'Spit (all)', action: 'spit' },
    { label: `Spit (current: ${state.env || 'none'})`, action: 'spit-current' }
  ];
  const picked = await vscode.window.showQuickPick(items, { placeHolder: 'Spit environment...' });
  if (!picked) return;

  const cwd = getCwd();
  if (!cwd) return;

  if (picked.action === 'spit') {
    await runCmd('spit', cwd);
    notify('Spit all');
  } else if (state.env) {
    await runCmd(`spit --env ${state.env}`, cwd);
    notify(`Spit ${state.env}`);
  }
  await refresh();
}

function activate(context) {
  statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  statusBarItem.command = 'swapenv.showMenu';
  context.subscriptions.push(statusBarItem);

  const cmds = [
    ['swapenv.showMenu', showMenu],
    ['swapenv.switchEnv', switchEnv],
    ['swapenv.load', loadCmd],
    ['swapenv.spit', spitCmd],
    ['swapenv.refresh', refresh],
    ['swapenv.showVersions', showVersions]
  ];

  for (const [id, fn] of cmds) {
    context.subscriptions.push(vscode.commands.registerCommand(id, fn));
  }

  context.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument(() => {
      if (getConfig('autoRefresh')) refresh();
    })
  );

  context.subscriptions.push(
    vscode.window.onDidChangeWindowState(e => {
      if (e.focused) refresh();
    })
  );

  refresh();
}

function deactivate() {}

module.exports = { activate, deactivate };
