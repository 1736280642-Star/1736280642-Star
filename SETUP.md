# GitHub Profile README 与 Codex 热力图配置

## 1. 工作原理

`ccusage` 在本机读取 Codex 会话日志并输出每日汇总；`codex-heatmap.cjs` 把汇总转换为 SVG；`sync-codex.ps1` 只提交 SVG 到 GitHub。

原始 `codex.json` 已被 `.gitignore` 排除。默认生成的公开 SVG 只显示活动强度、活跃天数和连续天数，不显示精确 Token 数。

## 2. 前置条件

安装以下工具：

- Node.js LTS
- Git for Windows
- 已经在本机使用过 Codex
- 已经完成 GitHub 登录，可通过 Git 推送仓库

检查环境：

```powershell
node --version
npx --version
git --version
```

## 3. 创建个人主页仓库

在 GitHub 创建一个 Public 空仓库，仓库名必须与 GitHub 用户名完全相同，不要勾选自动创建 README。

然后在本目录执行，把 `<github-username>` 替换为你的用户名：

```powershell
git init
git branch -M main
git add README.md SETUP.md AGENTS.md .gitignore codex-heatmap.cjs sync-codex.ps1 codex-heatmap.svg
git commit -m "feat: create GitHub profile README"
git remote add origin "https://github.com/<github-username>/<github-username>.git"
git push -u origin main
```

如果 Git 提示身份未配置：

```powershell
git config --global user.name "你的 GitHub 显示名"
git config --global user.email "你的 GitHub noreply 邮箱"
```

建议使用 GitHub 提供的 `noreply` 邮箱，避免公开私人邮箱。

## 4. 首次生成并同步

先只在本地生成并检查 SVG：

```powershell
.\sync-codex.ps1 -GenerateOnly
```

确认 `codex-heatmap.svg` 展示正常，并完成第 3 步的 Git 仓库配置后，再生成并推送：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File ".\sync-codex.ps1"
```

执行链路：

1. 固定使用 `ccusage@20.0.20` 读取本机 Codex 每日汇总。
2. 将 UTF-8 JSON 写入本地 `codex.json`。
3. 生成 `codex-heatmap.svg`。
4. 只有 SVG 发生变化时才提交并推送。

如果明确愿意公开精确 Token 数，可以手动选择：

```powershell
.\sync-codex.ps1 -ShowTokenCounts
```

## 5. 设置 Windows 每日自动同步

以普通用户身份打开 PowerShell，在本目录执行：

```powershell
$scriptPath = (Resolve-Path ".\sync-codex.ps1").Path
$taskAction = New-ScheduledTaskAction `
  -Execute "powershell.exe" `
  -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$scriptPath`""
$taskTrigger = New-ScheduledTaskTrigger -Daily -At "23:55"
$taskSettings = New-ScheduledTaskSettingsSet -StartWhenAvailable

Register-ScheduledTask `
  -TaskName "Sync Codex Heatmap" `
  -Action $taskAction `
  -Trigger $taskTrigger `
  -Settings $taskSettings `
  -Description "Generate and push the GitHub profile Codex heatmap"
```

电脑在计划时间关机时，任务会在下次可运行时补执行。首次创建后，可在 Windows Task Scheduler 中手动运行一次验证。

## 6. 更新 ccusage

自动化固定版本可以避免上游 JSON 结构突然变化。升级前先手动验证：

```powershell
npx.cmd --yes ccusage@latest codex daily --json
```

确认输出正常后，再修改 `sync-codex.ps1` 中的默认版本，并手动执行一次完整同步。

## 7. 常见问题

### `codex.json` 里出现安装确认文字

确保命令包含 `--yes`。不要使用会把首次安装提示重定向进 JSON 的旧命令。

### GitHub 主页没有展示 README

检查仓库是否为 Public，且仓库名是否与用户名完全一致。

### GitHub Actions 中没有数据

普通 GitHub 托管 Runner 无法访问电脑里的 Codex 日志。本项目使用 Windows 本地定时任务；不需要上传 Codex 会话文件或 API Key。
