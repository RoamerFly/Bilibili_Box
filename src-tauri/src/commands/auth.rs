use parking_lot::RwLock;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tauri::{AppHandle, State};

use crate::api::auth::{QrcodeData, QrcodeStatus, UserInfo};
use crate::api::BiliClient;
use crate::config::Config;
use crate::download::DownloadManager;

use super::ai::clear_api_keys_for_profile;

#[derive(Debug, Clone, Serialize)]
pub struct SavedAccountProfile {
    pub profile: String,
    pub username: String,
    pub mid: i64,
    pub face: String,
    pub active: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct AccountSwitchResult {
    pub config: Config,
    pub user_info: Option<UserInfo>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveLoginSessionParams {
    pub user_info: UserInfo,
    pub sessdata: String,
    pub cookie: Option<String>,
}

/// 生成二维码
#[tauri::command]
pub async fn generate_qrcode(
    bili_client: State<'_, Arc<BiliClient>>,
) -> Result<QrcodeData, String> {
    bili_client.generate_qrcode().await
}

/// 获取二维码状态
#[tauri::command]
pub async fn get_qrcode_status(
    bili_client: State<'_, Arc<BiliClient>>,
    qrcode_key: String,
) -> Result<QrcodeStatus, String> {
    bili_client.get_qrcode_status(&qrcode_key).await
}

/// 获取用户信息
#[tauri::command]
pub async fn get_user_info(
    bili_client: State<'_, Arc<BiliClient>>,
    sessdata: String,
) -> Result<UserInfo, String> {
    bili_client.get_user_info(&sessdata).await
}

fn current_login_time() -> String {
    chrono::Local::now().format("%Y-%m-%d %H:%M").to_string()
}

fn ensure_login_time(user_info: &mut UserInfo) {
    if user_info
        .login_time
        .as_deref()
        .unwrap_or("")
        .trim()
        .is_empty()
    {
        user_info.login_time = Some(current_login_time());
    }
}

pub(crate) fn cookie_mid(cookie: &str) -> Option<i64> {
    crate::api::video::extract_cookie_value(cookie, "DedeUserID")
        .and_then(|value| value.parse::<i64>().ok())
}

fn clear_profile_login_credentials(profile_dir: &std::path::Path) -> Result<(), String> {
    let config_path = profile_dir.join("config.json");
    if !config_path.exists() {
        return Ok(());
    }

    let content =
        std::fs::read_to_string(&config_path).map_err(|e| format!("读取账号配置失败: {e}"))?;
    let mut value = serde_json::from_str::<serde_json::Value>(&content)
        .map_err(|e| format!("解析账号配置失败: {e}"))?;
    if let Some(map) = value.as_object_mut() {
        map.insert(
            "sessdata".to_string(),
            serde_json::Value::String(String::new()),
        );
        map.insert(
            "cookie".to_string(),
            serde_json::Value::String(String::new()),
        );
    }
    let content =
        serde_json::to_string_pretty(&value).map_err(|e| format!("序列化账号配置失败: {e}"))?;
    std::fs::write(config_path, content).map_err(|e| format!("清理错配登录凭据失败: {e}"))
}

fn validate_cookie_owner(cookie: &str, expected_mid: i64) -> Result<(), String> {
    if let Some(actual_mid) = cookie_mid(cookie) {
        if actual_mid != expected_mid {
            return Err(format!(
                "账号登录凭据与本地账号不匹配：本地账号 mid 为 {}，cookie 属于 mid {}。请重新登录该账号。",
                expected_mid, actual_mid
            ));
        }
    }
    Ok(())
}

#[tauri::command]
pub fn save_login_session(
    app: AppHandle,
    config: State<'_, Arc<RwLock<Config>>>,
    bili_client: State<'_, Arc<BiliClient>>,
    download_manager: State<'_, Arc<DownloadManager>>,
    params: SaveLoginSessionParams,
) -> Result<AccountSwitchResult, String> {
    let mut user_info = params.user_info;
    if !user_info.is_login {
        return Err("登录校验失败，请重新登录".to_string());
    }

    let sessdata = params.sessdata.trim().to_string();
    if sessdata.is_empty() {
        return Err("登录凭据缺少 SESSDATA".to_string());
    }
    let cookie = params
        .cookie
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| format!("SESSDATA={}", sessdata));
    validate_cookie_owner(&cookie, user_info.mid)?;
    ensure_login_time(&mut user_info);

    let profile = Config::profile_name_from_user(&user_info.uname, user_info.mid);
    let previous_profile =
        Config::current_profile_name(&app).unwrap_or_else(|_| "guest".to_string());
    let should_migrate_legacy = Config::legacy_profile_matches(&app, user_info.mid);

    Config::set_current_profile(&app, &profile)?;
    Config::ensure_user_dirs(&app)?;
    let mut next_config = Config::load(&app)?;
    if should_migrate_legacy {
        let mut session_config = next_config.clone();
        session_config.sessdata = sessdata.clone();
        session_config.cookie = cookie.clone();
        next_config =
            Config::migrate_legacy_config_for_profile(&app, user_info.mid, &session_config)?;
    }
    next_config.sessdata = sessdata;
    next_config.cookie = cookie;
    *config.write() = next_config.clone();
    next_config.save(&app)?;

    let user_dir = Config::user_data_dir(&app)?;
    std::fs::create_dir_all(&user_dir).map_err(|e| format!("创建用户数据目录失败: {}", e))?;
    let user_path = Config::user_info_path(&app)?;
    let user_json =
        serde_json::to_string_pretty(&user_info).map_err(|e| format!("序列化用户信息失败: {e}"))?;
    std::fs::write(&user_path, user_json).map_err(|e| format!("写入用户信息失败: {e}"))?;

    download_manager.migrate_legacy_tasks_to_current_profile(
        should_migrate_legacy,
        previous_profile == "guest",
    )?;
    Config::clear_guest_account_data(&app)?;
    bili_client.reload_client()?;
    download_manager.reload_current_profile_tasks();

    Ok(AccountSwitchResult {
        config: next_config,
        user_info: Some(user_info),
    })
}

/// 保存已登录用户信息到当前用户的 data/{profile}/user.json。
#[tauri::command]
pub fn save_user_info(
    app: AppHandle,
    config: State<'_, Arc<RwLock<Config>>>,
    bili_client: State<'_, Arc<BiliClient>>,
    download_manager: State<'_, Arc<DownloadManager>>,
    mut user_info: UserInfo,
) -> Result<(), String> {
    {
        let current_config = config.read();
        validate_cookie_owner(&current_config.cookie, user_info.mid)?;
    }
    ensure_login_time(&mut user_info);
    let profile = Config::profile_name_from_user(&user_info.uname, user_info.mid);
    let previous_profile =
        Config::current_profile_name(&app).unwrap_or_else(|_| "guest".to_string());
    let should_migrate_legacy = Config::legacy_profile_matches(&app, user_info.mid);
    let current_config = config.read().clone();
    Config::set_current_profile(&app, &profile)?;
    let migrated_config =
        Config::migrate_legacy_config_for_profile(&app, user_info.mid, &current_config)?;
    *config.write() = migrated_config.clone();
    migrated_config.save(&app)?;
    let user_dir = Config::user_data_dir(&app)?;
    std::fs::create_dir_all(&user_dir).map_err(|e| format!("创建用户数据目录失败: {}", e))?;
    let user_path = Config::user_info_path(&app)?;
    let user_json =
        serde_json::to_string_pretty(&user_info).map_err(|e| format!("序列化用户信息失败: {e}"))?;
    std::fs::write(&user_path, user_json).map_err(|e| format!("写入用户信息失败: {e}"))?;
    download_manager.migrate_legacy_tasks_to_current_profile(
        should_migrate_legacy,
        previous_profile == "guest",
    )?;
    Config::clear_guest_account_data(&app)?;
    bili_client.reload_client()?;
    download_manager.reload_current_profile_tasks();
    Ok(())
}

/// 读取本地已保存用户信息
#[tauri::command]
pub fn get_saved_user_info(app: AppHandle) -> Result<Option<UserInfo>, String> {
    let user_path = Config::user_info_path(&app)?;
    if !user_path.exists() {
        return Ok(None);
    }

    let user_json =
        std::fs::read_to_string(&user_path).map_err(|e| format!("读取用户信息失败: {e}"))?;
    let user_info = serde_json::from_str::<UserInfo>(&user_json)
        .map_err(|e| format!("解析用户信息失败: {e}"))?;
    Ok(Some(user_info))
}

/// 清除本地用户信息
#[tauri::command]
pub fn clear_user_info(
    app: AppHandle,
    config: State<'_, Arc<RwLock<Config>>>,
    bili_client: State<'_, Arc<BiliClient>>,
    download_manager: State<'_, Arc<DownloadManager>>,
) -> Result<(), String> {
    Config::set_current_profile(&app, "guest")?;
    Config::ensure_user_dirs(&app)?;
    Config::clear_guest_account_data(&app)?;
    let guest_config = Config::load(&app)?;
    *config.write() = guest_config;
    bili_client.reload_client()?;
    download_manager.reload_current_profile_tasks();
    Ok(())
}

#[tauri::command]
pub fn list_saved_accounts(app: AppHandle) -> Result<Vec<SavedAccountProfile>, String> {
    let data_root = Config::data_root_dir(&app)?;
    let active_profile = Config::current_profile_name(&app)?;
    if !data_root.is_dir() {
        return Ok(Vec::new());
    }

    let mut accounts = Vec::new();
    for entry in std::fs::read_dir(&data_root)
        .map_err(|e| format!("读取账号目录失败: {e}"))?
        .filter_map(Result::ok)
    {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let Some(profile) = path
            .file_name()
            .and_then(|value| value.to_str())
            .map(str::to_string)
        else {
            continue;
        };
        if profile == "guest" {
            continue;
        }
        let user_path = path.join("user.json");
        if !user_path.exists() {
            continue;
        }
        let Ok(user_json) = std::fs::read_to_string(&user_path) else {
            continue;
        };
        let Ok(user_info) = serde_json::from_str::<UserInfo>(&user_json) else {
            continue;
        };
        accounts.push(SavedAccountProfile {
            profile: profile.clone(),
            username: user_info.uname,
            mid: user_info.mid,
            face: user_info.face,
            active: profile == active_profile,
        });
    }

    accounts.sort_by(|left, right| {
        right
            .active
            .cmp(&left.active)
            .then_with(|| left.username.cmp(&right.username))
    });
    Ok(accounts)
}

#[tauri::command]
pub fn switch_account_profile(
    app: AppHandle,
    config: State<'_, Arc<RwLock<Config>>>,
    bili_client: State<'_, Arc<BiliClient>>,
    download_manager: State<'_, Arc<DownloadManager>>,
    profile: String,
) -> Result<AccountSwitchResult, String> {
    let profile = Config::sanitize_path_component(&profile);
    if profile == "guest" {
        return Err("请使用退出登录进入 guest 模式".to_string());
    }
    let data_root = Config::data_root_dir(&app)?;
    let profile_dir = data_root.join(&profile);
    let user_path = profile_dir.join("user.json");
    if !user_path.exists() {
        return Err("账号数据不存在，无法切换".to_string());
    }
    let user_json =
        std::fs::read_to_string(&user_path).map_err(|e| format!("读取账号信息失败: {e}"))?;
    let mut user_info = serde_json::from_str::<UserInfo>(&user_json)
        .map_err(|e| format!("解析账号信息失败: {e}"))?;

    let config_path = profile_dir.join("config.json");
    if config_path.exists() {
        let config_json =
            std::fs::read_to_string(&config_path).map_err(|e| format!("读取账号配置失败: {e}"))?;
        if let Ok(value) = serde_json::from_str::<serde_json::Value>(&config_json) {
            let cookie = value
                .get("cookie")
                .and_then(|value| value.as_str())
                .unwrap_or("");
            if let Err(err) = validate_cookie_owner(cookie, user_info.mid) {
                clear_profile_login_credentials(&profile_dir)?;
                return Err(format!("{} 已清理该账号的错配登录凭据，请重新登录。", err));
            }
        }
    }
    ensure_login_time(&mut user_info);

    Config::set_current_profile(&app, &profile)?;
    Config::ensure_user_dirs(&app)?;
    let next_config = Config::load(&app)?;
    *config.write() = next_config.clone();
    bili_client.reload_client()?;
    download_manager.reload_current_profile_tasks();
    let user_json =
        serde_json::to_string_pretty(&user_info).map_err(|e| format!("序列化账号信息失败: {e}"))?;
    std::fs::write(&user_path, user_json).map_err(|e| format!("写入账号信息失败: {e}"))?;
    Ok(AccountSwitchResult {
        config: next_config,
        user_info: Some(user_info),
    })
}

#[tauri::command]
pub fn delete_saved_account_data(
    app: AppHandle,
    config: State<'_, Arc<RwLock<Config>>>,
    bili_client: State<'_, Arc<BiliClient>>,
    download_manager: State<'_, Arc<DownloadManager>>,
    profile: String,
) -> Result<AccountSwitchResult, String> {
    let profile = Config::sanitize_path_component(&profile);
    if profile == "guest" {
        return Err("不能删除 guest 工作区".to_string());
    }

    let data_root = Config::data_root_dir(&app)?;
    let profile_dir = data_root.join(&profile);
    if !profile_dir.exists() {
        return Err("账号数据不存在或已被删除".to_string());
    }
    if !profile_dir.is_dir() {
        return Err("账号数据路径异常，拒绝删除".to_string());
    }

    let root = data_root
        .canonicalize()
        .map_err(|e| format!("读取数据根目录失败: {e}"))?;
    let target = profile_dir
        .canonicalize()
        .map_err(|e| format!("读取账号目录失败: {e}"))?;
    if target == root || !target.starts_with(&root) {
        return Err("账号数据路径越界，拒绝删除".to_string());
    }

    let active_profile = Config::current_profile_name(&app)?;
    // Remove the separately stored API key before deleting the profile data. If
    // the OS credential service is unavailable, stop here so deletion cannot
    // silently leave a secret behind in the keyring.
    clear_api_keys_for_profile(&app, &profile)?;
    std::fs::remove_dir_all(&target)
        .map_err(|e| format!("删除账号数据失败 ({}): {e}", target.display()))?;

    if active_profile == profile {
        Config::set_current_profile(&app, "guest")?;
        Config::ensure_user_dirs(&app)?;
        Config::clear_guest_account_data(&app)?;
        let guest_config = Config::load(&app)?;
        *config.write() = guest_config.clone();
        bili_client.reload_client()?;
        download_manager.reload_current_profile_tasks();
        Ok(AccountSwitchResult {
            config: guest_config,
            user_info: None,
        })
    } else {
        let current_config = Config::load(&app)?;
        *config.write() = current_config.clone();
        let user_info = get_saved_user_info(app).unwrap_or(None);
        Ok(AccountSwitchResult {
            config: current_config,
            user_info,
        })
    }
}
