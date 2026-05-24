use parking_lot::RwLock;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tauri::AppHandle;
use tauri::Manager;

use super::{HookContext, HookPoint, PluginInfo, PluginManifest, PluginResult};

/// 脚本插件 - 基于 JSON 配置和命令执行
struct ScriptPlugin {
    info: PluginInfo,
    manifest: PluginManifest,
    dir_path: PathBuf,
}

impl ScriptPlugin {
    fn new(manifest: PluginManifest, dir_path: PathBuf) -> Self {
        let info = PluginInfo {
            id: manifest.id.clone(),
            name: manifest.name.clone(),
            version: manifest.version.clone(),
            description: manifest.description.clone(),
            author: manifest.author.clone(),
            enabled: true,
            priority: manifest.priority.unwrap_or(0),
            path: Some(dir_path.to_string_lossy().to_string()),
        };

        Self {
            info,
            manifest,
            dir_path,
        }
    }

    fn supports_hook(&self, point: &HookPoint) -> bool {
        let hook_name = point.to_str();
        self.manifest.hooks.iter().any(|h| h == hook_name)
    }

    fn execute(&self, point: &HookPoint, ctx: &HookContext) -> Result<PluginResult, String> {
        let hook_name = point.to_str();

        // 查找钩子脚本文件
        let script_path = self.dir_path.join(format!("{}.json", hook_name));
        if !script_path.exists() {
            // 尝试查找通用钩子脚本
            let script_path = self.dir_path.join(format!("{}.sh", hook_name));
            if script_path.exists() {
                return self.execute_script(&script_path, ctx);
            }
            return Ok(PluginResult::ok());
        }

        // 读取并执行 JSON 钩子配置
        let config_content = std::fs::read_to_string(&script_path)
            .map_err(|e| format!("读取钩子配置失败: {}", e))?;

        let config: serde_json::Value = serde_json::from_str(&config_content)
            .map_err(|e| format!("解析钩子配置失败: {}", e))?;

        // 处理配置
        self.process_hook_config(&config, ctx)
    }

    fn execute_script(
        &self,
        script_path: &Path,
        ctx: &HookContext,
    ) -> Result<PluginResult, String> {
        #[cfg(target_os = "windows")]
        let output = std::process::Command::new("cmd")
            .args(["/C", &script_path.to_string_lossy()])
            .env("PLUGIN_TASK_ID", ctx.task_id.clone().unwrap_or_default())
            .env(
                "PLUGIN_VIDEO_PATH",
                ctx.video_path.clone().unwrap_or_default(),
            )
            .env("PLUGIN_BVID", ctx.bvid.clone().unwrap_or_default())
            .output();

        #[cfg(not(target_os = "windows"))]
        let output = std::process::Command::new("sh")
            .arg(script_path)
            .env("PLUGIN_TASK_ID", ctx.task_id.clone().unwrap_or_default())
            .env(
                "PLUGIN_VIDEO_PATH",
                ctx.video_path.clone().unwrap_or_default(),
            )
            .env("PLUGIN_BVID", ctx.bvid.clone().unwrap_or_default())
            .output();

        match output {
            Ok(output) => {
                if output.status.success() {
                    let _stdout = String::from_utf8_lossy(&output.stdout);
                    Ok(PluginResult::ok())
                } else {
                    let stderr = String::from_utf8_lossy(&output.stderr);
                    Ok(PluginResult::error(&stderr))
                }
            }
            Err(e) => Err(format!("执行脚本失败: {}", e)),
        }
    }

    fn process_hook_config(
        &self,
        config: &serde_json::Value,
        ctx: &HookContext,
    ) -> Result<PluginResult, String> {
        // 处理不同类型的钩子配置
        if let Some(actions) = config.get("actions").and_then(|a| a.as_array()) {
            for action in actions {
                self.execute_action(action, ctx)?;
            }
        }

        Ok(PluginResult::ok())
    }

    fn execute_action(
        &self,
        action: &serde_json::Value,
        ctx: &HookContext,
    ) -> Result<PluginResult, String> {
        let action_type = action
            .get("type")
            .and_then(|t| t.as_str())
            .unwrap_or("unknown");

        match action_type {
            "log" => {
                let message = action.get("message").and_then(|m| m.as_str()).unwrap_or("");
                log::info!("[Plugin {}] {}", self.info.name, message);
                Ok(PluginResult::ok())
            }
            "copy_file" => {
                // 文件复制操作
                let source = action.get("source").and_then(|s| s.as_str());
                let target = action.get("target").and_then(|t| t.as_str());

                if let (Some(source), Some(target)) = (source, target) {
                    let source_path = self.dir_path.join(source);
                    let target_path = if let Some(video_path) = &ctx.video_path {
                        PathBuf::from(video_path)
                            .parent()
                            .unwrap_or(Path::new("."))
                            .join(target)
                    } else {
                        PathBuf::from(target)
                    };

                    if source_path.exists() {
                        std::fs::copy(&source_path, &target_path)
                            .map_err(|e| format!("复制文件失败: {}", e))?;
                    }
                }
                Ok(PluginResult::ok())
            }
            _ => {
                log::warn!("未知的钩子动作类型: {}", action_type);
                Ok(PluginResult::ok())
            }
        }
    }
}

/// 插件管理器
pub struct PluginManager {
    app: AppHandle,
    plugins: RwLock<HashMap<String, Arc<ScriptPlugin>>>,
    plugin_dir: PathBuf,
    disabled_plugins: RwLock<std::collections::HashSet<String>>,
}

impl PluginManager {
    /// 创建新的插件管理器
    pub fn new(app: AppHandle) -> Self {
        let plugin_dir = app
            .path()
            .app_config_dir()
            .unwrap_or_else(|_| PathBuf::from("."))
            .join("plugins");

        Self {
            app,
            plugins: RwLock::new(HashMap::new()),
            plugin_dir,
            disabled_plugins: RwLock::new(std::collections::HashSet::new()),
        }
    }

    /// 获取插件目录
    pub fn plugin_dir(&self) -> &Path {
        &self.plugin_dir
    }

    /// 加载插件
    pub fn load_plugins(&self) -> Result<(), String> {
        // 确保插件目录存在
        if !self.plugin_dir.exists() {
            std::fs::create_dir_all(&self.plugin_dir)
                .map_err(|e| format!("创建插件目录失败: {}", e))?;
            log::info!("创建插件目录: {:?}", self.plugin_dir);
            return Ok(());
        }

        // 扫描插件目录
        let entries =
            std::fs::read_dir(&self.plugin_dir).map_err(|e| format!("读取插件目录失败: {}", e))?;

        let mut plugins = self.plugins.write();
        plugins.clear();

        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                let manifest_path = path.join("manifest.json");
                if manifest_path.exists() {
                    match self.load_plugin_from_dir(&path) {
                        Ok(plugin) => {
                            log::info!("加载插件: {} ({})", plugin.info.name, plugin.info.id);
                            plugins.insert(plugin.info.id.clone(), Arc::new(plugin));
                        }
                        Err(e) => {
                            log::warn!("加载插件失败 {:?}: {}", path, e);
                        }
                    }
                }
            }
        }

        log::info!("共加载 {} 个插件", plugins.len());
        Ok(())
    }

    /// 从目录加载单个插件
    fn load_plugin_from_dir(&self, dir_path: &Path) -> Result<ScriptPlugin, String> {
        let manifest_path = dir_path.join("manifest.json");
        let manifest_content = std::fs::read_to_string(&manifest_path)
            .map_err(|e| format!("读取清单文件失败: {}", e))?;

        let manifest: PluginManifest = serde_json::from_str(&manifest_content)
            .map_err(|e| format!("解析清单文件失败: {}", e))?;

        Ok(ScriptPlugin::new(manifest, dir_path.to_path_buf()))
    }

    /// 执行钩子
    pub fn execute_hook(
        &self,
        point: &HookPoint,
        ctx: &HookContext,
    ) -> Result<Vec<PluginResult>, String> {
        let plugins = self.plugins.read();
        let disabled = self.disabled_plugins.read();

        // 按优先级排序执行
        let mut sorted_plugins: Vec<_> = plugins
            .values()
            .filter(|p| !disabled.contains(&p.info.id) && p.supports_hook(point))
            .collect();

        sorted_plugins.sort_by_key(|p| -p.info.priority);

        let mut results = Vec::new();
        for plugin in sorted_plugins {
            match plugin.execute(point, ctx) {
                Ok(result) => {
                    if !result.success {
                        log::warn!(
                            "插件 {} 执行钩子失败: {:?}",
                            plugin.info.name,
                            result.message
                        );
                    }
                    results.push(result);
                }
                Err(e) => {
                    log::error!("插件 {} 执行钩子出错: {}", plugin.info.name, e);
                    results.push(PluginResult::error(&e));
                }
            }
        }

        Ok(results)
    }

    /// 获取插件列表
    pub fn get_plugins(&self) -> Vec<PluginInfo> {
        let plugins = self.plugins.read();
        let disabled = self.disabled_plugins.read();

        plugins
            .values()
            .map(|p| {
                let mut info = p.info.clone();
                info.enabled = !disabled.contains(&info.id);
                info
            })
            .collect()
    }

    /// 启用插件
    pub fn enable_plugin(&self, plugin_id: &str) -> Result<(), String> {
        let plugins = self.plugins.read();
        if !plugins.contains_key(plugin_id) {
            return Err(format!("插件不存在: {}", plugin_id));
        }

        let mut disabled = self.disabled_plugins.write();
        disabled.remove(plugin_id);

        log::info!("启用插件: {}", plugin_id);
        Ok(())
    }

    /// 禁用插件
    pub fn disable_plugin(&self, plugin_id: &str) -> Result<(), String> {
        let plugins = self.plugins.read();
        if !plugins.contains_key(plugin_id) {
            return Err(format!("插件不存在: {}", plugin_id));
        }

        let mut disabled = self.disabled_plugins.write();
        disabled.insert(plugin_id.to_string());

        log::info!("禁用插件: {}", plugin_id);
        Ok(())
    }

    /// 卸载插件
    pub fn unload_plugin(&self, plugin_id: &str) -> Result<(), String> {
        let mut plugins = self.plugins.write();
        plugins.remove(plugin_id);

        let mut disabled = self.disabled_plugins.write();
        disabled.remove(plugin_id);

        log::info!("卸载插件: {}", plugin_id);
        Ok(())
    }

    /// 刷新插件列表
    pub fn refresh(&self) -> Result<(), String> {
        self.load_plugins()
    }
}
