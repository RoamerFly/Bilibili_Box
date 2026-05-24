//! BiliBox Plugin SDK
//!
//! 这个库提供了开发 BiliBox 插件所需的类型和接口。

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// 钩子点枚举
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum HookPoint {
    AfterPrepare,
    BeforeVideoProcess,
    OnCompleted,
}

/// 钩子上下文
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HookContext {
    pub task_id: String,
    pub video_path: Option<String>,
    pub data: HashMap<String, String>,
}

/// 插件信息
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PluginInfo {
    pub name: String,
    pub version: String,
    pub description: String,
    pub author: String,
}

/// 插件接口 trait
pub trait Plugin {
    /// 获取插件信息
    fn info(&self) -> PluginInfo;

    /// 处理钩子
    fn on_hook(&self, point: &HookPoint, ctx: &mut HookContext) -> Result<(), String>;
}

/// 定义插件的宏
#[macro_export]
macro_rules! define_plugin {
    ($plugin_type:ty) => {
        #[no_mangle]
        pub extern "C" fn plugin_info() -> *const u8 {
            // 返回插件信息的指针
            std::ptr::null()
        }

        #[no_mangle]
        pub extern "C" fn plugin_hook(point: i32, ctx_ptr: *const u8) -> i32 {
            // 处理钩子调用
            0
        }
    };
}
