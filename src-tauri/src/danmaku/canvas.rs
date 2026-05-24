use super::xml_parser::{DanmakuMode, ParsedDanmaku};

/// 画布配置
#[derive(Debug, Clone)]
pub struct CanvasConfig {
    pub duration: f64,          // 弹幕持续时间(秒)
    pub width: u32,             // 屏幕宽度
    pub height: u32,            // 屏幕高度
    pub font_name: String,      // 字体名称
    pub font_size: u32,         // 字体大小
    pub width_ratio: f64,       // 宽度比例因子
    pub horizontal_gap: f64,    // 水平间距
    pub lane_height: u32,       // 行高
    pub float_percentage: f64,  // 滚动弹幕填充比例
    pub bottom_percentage: f64, // 底部弹幕比例
    pub alpha: f64,             // 不透明度
    pub bold: bool,             // 是否加粗
    pub outline: f64,           // 描边宽度
}

impl Default for CanvasConfig {
    fn default() -> Self {
        Self {
            duration: 10.0,
            width: 1920,
            height: 1080,
            font_name: "SimHei".to_string(),
            font_size: 38,
            width_ratio: 1.2,
            horizontal_gap: 20.0,
            lane_height: 44,
            float_percentage: 0.6,
            bottom_percentage: 0.3,
            alpha: 0.7,
            bold: false,
            outline: 1.0,
        }
    }
}

/// 弹道信息
#[derive(Debug, Clone)]
struct Lane {
    /// 当前弹幕的结束时间
    end_time: f64,
    /// 当前弹幕的右边位置
    right_pos: f64,
}

impl Lane {
    fn new() -> Self {
        Self {
            end_time: 0.0,
            right_pos: 0.0,
        }
    }
}

/// 碰撞检测结果
enum Collision {
    /// 不会碰撞，距离足够
    Safe,
    /// 需要等待指定时间
    Wait(f64),
    /// 此弹道不可用
    Occupied,
}

/// 弹幕绘制结果
#[derive(Debug, Clone)]
pub struct Drawable {
    pub danmaku: ParsedDanmaku,
    pub x_start: f64,
    pub x_end: f64,
    pub y: f64,
    pub duration: f64,
    pub style_name: String,
}

/// 弹幕画布
pub struct DanmakuCanvas {
    config: CanvasConfig,
    float_lanes: Vec<Lane>,
    bottom_lanes: Vec<Lane>,
    top_lanes: Vec<Lane>,
}

impl DanmakuCanvas {
    /// 创建新的画布
    pub fn new(config: CanvasConfig) -> Self {
        // 计算轨道数量
        let float_height = (config.height as f64 * config.float_percentage) as u32;
        let float_lane_count = (float_height / config.lane_height).max(1) as usize;

        let bottom_height = (config.height as f64 * config.bottom_percentage) as u32;
        let bottom_lane_count = (bottom_height / config.lane_height).max(1) as usize;

        // 顶部弹幕使用部分轨道
        let top_lane_count = bottom_lane_count;

        Self {
            config,
            float_lanes: vec![Lane::new(); float_lane_count],
            bottom_lanes: vec![Lane::new(); bottom_lane_count],
            top_lanes: vec![Lane::new(); top_lane_count],
        }
    }

    /// 检测滚动弹幕与前一条弹幕的碰撞
    fn check_float_collision(
        lane: &Lane,
        danmaku_width: f64,
        current_time: f64,
        config: &CanvasConfig,
    ) -> Collision {
        let screen_width = config.width as f64;
        let duration = config.duration;
        let gap = config.horizontal_gap;

        // 如果轨道为空或已结束，直接可用
        if lane.end_time <= current_time {
            return Collision::Safe;
        }

        // 计算前一条弹幕的位置
        let time_passed = current_time - (lane.end_time - duration);
        let prev_speed = (screen_width + lane.right_pos - lane.end_time + duration) / duration;
        let prev_x_end = lane.right_pos - prev_speed * time_passed;

        // 当前弹幕从右侧进入
        let current_speed = (screen_width + danmaku_width) / duration;

        // 检查是否有足够间距
        let distance = prev_x_end - screen_width;
        let min_distance = gap;

        if distance >= min_distance {
            return Collision::Safe;
        }

        // 需要等待一段时间让前一条弹幕移动
        let speed_diff = current_speed - prev_speed;
        if speed_diff <= 0.0 {
            // 当前弹幕更慢，永远不会碰撞
            return Collision::Safe;
        }

        let time_needed = (min_distance - distance) / speed_diff;
        Collision::Wait(time_needed)
    }

    /// 分配滚动弹幕轨道
    pub fn allocate_float_track(
        &mut self,
        danmaku: &ParsedDanmaku,
        current_time: f64,
    ) -> Option<f64> {
        let danmaku_width = danmaku.calc_width(self.config.font_size, self.config.width_ratio);
        let mut best_lane = None;
        let mut min_wait = f64::MAX;

        for (i, lane) in self.float_lanes.iter().enumerate() {
            match Self::check_float_collision(lane, danmaku_width, current_time, &self.config) {
                Collision::Safe => {
                    // 找到可用轨道
                    best_lane = Some(i);
                    break;
                }
                Collision::Wait(wait_time) => {
                    if wait_time < min_wait {
                        min_wait = wait_time;
                        best_lane = Some(i);
                    }
                }
                Collision::Occupied => continue,
            }
        }

        if let Some(lane_idx) = best_lane {
            let y = lane_idx as f64 * self.config.lane_height as f64;
            let screen_width = self.config.width as f64;

            // 更新轨道状态
            let lane = &mut self.float_lanes[lane_idx];
            lane.end_time = current_time + self.config.duration;
            lane.right_pos = screen_width + danmaku_width;

            Some(y)
        } else {
            None
        }
    }

    /// 分配顶部弹幕轨道
    pub fn allocate_top_track(
        &mut self,
        _danmaku: &ParsedDanmaku,
        current_time: f64,
    ) -> Option<f64> {
        for (i, lane) in self.top_lanes.iter_mut().enumerate() {
            if lane.end_time <= current_time {
                lane.end_time = current_time + 3.0; // 顶部弹幕显示3秒
                let y = i as f64 * self.config.lane_height as f64;
                return Some(y);
            }
        }
        None
    }

    /// 分配底部弹幕轨道
    pub fn allocate_bottom_track(
        &mut self,
        _danmaku: &ParsedDanmaku,
        current_time: f64,
    ) -> Option<f64> {
        let base_y = self.config.height as f64 * (1.0 - self.config.bottom_percentage);
        for (i, lane) in self.bottom_lanes.iter_mut().enumerate() {
            if lane.end_time <= current_time {
                lane.end_time = current_time + 3.0; // 底部弹幕显示3秒
                let y = base_y + i as f64 * self.config.lane_height as f64;
                return Some(y);
            }
        }
        None
    }

    /// 绘制弹幕
    pub fn draw(&mut self, danmaku: ParsedDanmaku) -> Option<Drawable> {
        let current_time = danmaku.timeline_s;
        let danmaku_width = danmaku.calc_width(self.config.font_size, self.config.width_ratio);
        let screen_width = self.config.width as f64;

        match danmaku.mode {
            DanmakuMode::Float | DanmakuMode::Reverse => {
                if let Some(y) = self.allocate_float_track(&danmaku, current_time) {
                    Some(Drawable {
                        x_start: screen_width,
                        x_end: screen_width + danmaku_width,
                        y,
                        duration: self.config.duration,
                        style_name: "Float".to_string(),
                        danmaku,
                    })
                } else {
                    None
                }
            }
            DanmakuMode::Top => {
                if let Some(y) = self.allocate_top_track(&danmaku, current_time) {
                    Some(Drawable {
                        x_start: 0.0,
                        x_end: danmaku_width,
                        y,
                        duration: 3.0,
                        style_name: "Top".to_string(),
                        danmaku,
                    })
                } else {
                    None
                }
            }
            DanmakuMode::Bottom => {
                if let Some(y) = self.allocate_bottom_track(&danmaku, current_time) {
                    Some(Drawable {
                        x_start: 0.0,
                        x_end: danmaku_width,
                        y,
                        duration: 3.0,
                        style_name: "Bottom".to_string(),
                        danmaku,
                    })
                } else {
                    None
                }
            }
            DanmakuMode::Special => {
                // 高级弹幕暂不处理
                None
            }
        }
    }
}
