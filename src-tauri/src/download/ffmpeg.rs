use ffmpeg_sidecar::command::FfmpegCommand;
use ffmpeg_sidecar::event::{FfmpegEvent, FfmpegProgress};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

pub struct FfmpegExecutor {
    ffmpeg_path: Option<PathBuf>,
    ffprobe_path: Option<PathBuf>,
}

pub type ProgressCallback = Box<dyn Fn(f64) + Send + Sync>;

impl FfmpegExecutor {
    pub fn new() -> Result<Self, String> {
        let executor = Self::default();
        if executor.is_available() {
            Ok(executor)
        } else {
            Err("FFmpeg is not available. Put ffmpeg and ffprobe in the env folder.".to_string())
        }
    }

    pub fn with_path(path: PathBuf) -> Self {
        let ffprobe_path = path
            .parent()
            .map(|parent| parent.join(Self::tool_file_name("ffprobe")))
            .filter(|candidate| candidate.exists())
            .or_else(|| Self::resolve_tool("ffprobe"));

        Self {
            ffmpeg_path: Some(path),
            ffprobe_path,
        }
    }

    pub fn is_available(&self) -> bool {
        self.ffmpeg_path.is_some()
    }

    pub fn version(&self) -> Result<String, String> {
        let ffmpeg_path = self
            .ffmpeg_path
            .clone()
            .ok_or_else(|| "FFmpeg is not available".to_string())?;

        let mut command = Command::new(&ffmpeg_path);
        let output = Self::background_command(&mut command)
            .arg("-version")
            .output()
            .map_err(|e| format!("Failed to run FFmpeg: {}", e))?;

        let version_str = String::from_utf8_lossy(&output.stdout);
        let first_line = version_str
            .lines()
            .next()
            .unwrap_or("Unknown FFmpeg version");
        Ok(first_line.to_string())
    }

    pub async fn merge_audio_video(
        &self,
        video_path: &Path,
        audio_path: &Path,
        output_path: &Path,
        progress_callback: Option<ProgressCallback>,
    ) -> Result<PathBuf, String> {
        log::info!(
            "Starting FFmpeg merge: video={}, audio={}, output={}",
            video_path.display(),
            audio_path.display(),
            output_path.display()
        );

        if let Some(parent) = output_path.parent() {
            tokio::fs::create_dir_all(parent)
                .await
                .map_err(|e| format!("Failed to create output directory: {}", e))?;
        }

        let ffmpeg_path = self
            .ffmpeg_path
            .clone()
            .ok_or_else(|| "FFmpeg is not available".to_string())?;
        let video_path = video_path.to_path_buf();
        let audio_path = audio_path.to_path_buf();
        let output_path = output_path.to_path_buf();

        tokio::task::spawn_blocking(move || {
            Self::run_merge(
                &ffmpeg_path,
                &video_path,
                &audio_path,
                &output_path,
                progress_callback,
            )
        })
        .await
        .map_err(|e| format!("FFmpeg merge task failed: {}", e))?
    }

    fn run_merge(
        ffmpeg_path: &Path,
        video_path: &Path,
        audio_path: &Path,
        output_path: &Path,
        progress_callback: Option<ProgressCallback>,
    ) -> Result<PathBuf, String> {
        let mut cmd = FfmpegCommand::new_with_path(ffmpeg_path.as_os_str());
        let cmd = cmd
            .create_no_window()
            .input(video_path.to_str().ok_or("Invalid video path")?)
            .input(audio_path.to_str().ok_or("Invalid audio path")?)
            .args(&["-c:v", "copy"])
            .args(&["-c:a", "aac"])
            .args(&["-strict", "experimental"])
            .output(output_path.to_str().ok_or("Invalid output path")?)
            .overwrite();

        let mut child = cmd
            .spawn()
            .map_err(|e| format!("Failed to start FFmpeg: {}", e))?;

        for event in child
            .iter()
            .map_err(|e| format!("Failed to read FFmpeg events: {}", e))?
        {
            match event {
                FfmpegEvent::Progress(FfmpegProgress { time, .. }) => {
                    if let Some(ref callback) = progress_callback {
                        callback(Self::parse_time_to_seconds(&time));
                    }
                }
                FfmpegEvent::Log(_, msg) => {
                    log::debug!("FFmpeg: {}", msg);
                }
                FfmpegEvent::Done => {
                    log::info!("FFmpeg merge completed");
                    break;
                }
                FfmpegEvent::Error(e) => {
                    return Err(format!("FFmpeg error: {}", e));
                }
                _ => {}
            }
        }

        let exit_status = child
            .wait()
            .map_err(|e| format!("Failed to wait for FFmpeg: {}", e))?;

        if !exit_status.success() {
            return Err(format!("FFmpeg exited with code: {:?}", exit_status.code()));
        }

        Ok(output_path.to_path_buf())
    }

    fn parse_time_to_seconds(time_str: &str) -> f64 {
        let parts: Vec<&str> = time_str.split(':').collect();
        if parts.len() != 3 {
            return 0.0;
        }

        let hours: f64 = parts[0].parse().unwrap_or(0.0);
        let minutes: f64 = parts[1].parse().unwrap_or(0.0);
        let seconds: f64 = parts[2].parse().unwrap_or(0.0);

        hours * 3600.0 + minutes * 60.0 + seconds
    }

    pub async fn get_duration(&self, file_path: &Path) -> Result<f64, String> {
        let ffprobe_path = self
            .ffprobe_path
            .clone()
            .ok_or_else(|| "FFprobe is not available".to_string())?;
        let path = file_path.to_path_buf();

        tokio::task::spawn_blocking(move || {
            let mut command = Command::new(&ffprobe_path);
            let output = Self::background_command(&mut command)
                .args([
                    "-v",
                    "error",
                    "-show_entries",
                    "format=duration",
                    "-of",
                    "default=noprint_wrappers=1:nokey=1",
                ])
                .arg(path.to_str().ok_or("Invalid path")?)
                .output()
                .map_err(|e| format!("Failed to run FFprobe: {}", e))?;

            let duration_str = String::from_utf8_lossy(&output.stdout);
            duration_str
                .trim()
                .parse::<f64>()
                .map_err(|e| format!("Failed to parse duration: {}", e))
        })
        .await
        .map_err(|e| format!("Duration task failed: {}", e))?
    }

    pub async fn convert_to_mp4(
        &self,
        input_path: &Path,
        output_path: &Path,
    ) -> Result<PathBuf, String> {
        let ffmpeg_path = self
            .ffmpeg_path
            .clone()
            .ok_or_else(|| "FFmpeg is not available".to_string())?;
        let input = input_path.to_path_buf();
        let output = output_path.to_path_buf();

        tokio::task::spawn_blocking(move || {
            let mut cmd = FfmpegCommand::new_with_path(ffmpeg_path.as_os_str());
            let cmd = cmd
                .create_no_window()
                .input(input.to_str().ok_or("Invalid input path")?)
                .args(&["-c:v", "copy"])
                .args(&["-c:a", "aac"])
                .output(output.to_str().ok_or("Invalid output path")?)
                .overwrite();

            Self::wait_for_ffmpeg(cmd)?;
            Ok(output)
        })
        .await
        .map_err(|e| format!("Convert task failed: {}", e))?
    }

    pub async fn extract_audio(
        &self,
        input_path: &Path,
        output_path: &Path,
    ) -> Result<PathBuf, String> {
        let ffmpeg_path = self
            .ffmpeg_path
            .clone()
            .ok_or_else(|| "FFmpeg is not available".to_string())?;
        let input = input_path.to_path_buf();
        let output = output_path.to_path_buf();

        tokio::task::spawn_blocking(move || {
            let mut cmd = FfmpegCommand::new_with_path(ffmpeg_path.as_os_str());
            let cmd = cmd
                .create_no_window()
                .input(input.to_str().ok_or("Invalid input path")?)
                .args(&["-vn"])
                .args(&["-acodec", "copy"])
                .output(output.to_str().ok_or("Invalid output path")?)
                .overwrite();

            Self::wait_for_ffmpeg(cmd)?;
            Ok(output)
        })
        .await
        .map_err(|e| format!("Extract audio task failed: {}", e))?
    }

    pub async fn convert_audio_to_mp3(
        &self,
        input_path: &Path,
        output_path: &Path,
    ) -> Result<PathBuf, String> {
        let ffmpeg_path = self
            .ffmpeg_path
            .clone()
            .ok_or_else(|| "FFmpeg is not available".to_string())?;
        let input = input_path.to_path_buf();
        let output = output_path.to_path_buf();

        log::info!(
            "Starting FFmpeg audio conversion: input={}, output={}",
            input.display(),
            output.display()
        );

        tokio::task::spawn_blocking(move || {
            let mut cmd = FfmpegCommand::new_with_path(ffmpeg_path.as_os_str());
            let cmd = cmd
                .create_no_window()
                .input(input.to_str().ok_or("Invalid audio input path")?)
                .args(&["-vn"])
                .args(&["-codec:a", "libmp3lame"])
                .args(&["-q:a", "2"])
                .output(output.to_str().ok_or("Invalid audio output path")?)
                .overwrite();

            Self::wait_for_ffmpeg(cmd)?;
            Ok(output)
        })
        .await
        .map_err(|e| format!("MP3 conversion task failed: {}", e))?
    }

    fn wait_for_ffmpeg(cmd: &mut FfmpegCommand) -> Result<(), String> {
        let mut child = cmd
            .spawn()
            .map_err(|e| format!("Failed to start FFmpeg: {}", e))?;

        for event in child
            .iter()
            .map_err(|e| format!("Failed to read FFmpeg events: {}", e))?
        {
            match event {
                FfmpegEvent::Error(e) => {
                    return Err(format!("FFmpeg error: {}", e));
                }
                FfmpegEvent::Done => break,
                _ => {}
            }
        }

        let exit_status = child
            .wait()
            .map_err(|e| format!("Failed to wait for FFmpeg: {}", e))?;

        if !exit_status.success() {
            return Err(format!("FFmpeg exited with code: {:?}", exit_status.code()));
        }

        Ok(())
    }

    fn resolve_tool(stem: &str) -> Option<PathBuf> {
        for candidate in Self::tool_candidates(stem) {
            if candidate.exists() {
                return Some(candidate);
            }
        }

        let command = PathBuf::from(stem);
        if Self::command_works(&command) {
            Some(command)
        } else {
            None
        }
    }

    fn tool_candidates(stem: &str) -> Vec<PathBuf> {
        let file_name = Self::tool_file_name(stem);
        let mut candidates = Vec::new();

        if let Ok(current_exe) = std::env::current_exe() {
            if let Some(exe_dir) = current_exe.parent() {
                candidates.push(exe_dir.join("env").join(&file_name));
                candidates.push(exe_dir.join("env").join("bin").join(&file_name));
                candidates.push(
                    exe_dir
                        .join("env")
                        .join("ffmpeg")
                        .join("bin")
                        .join(&file_name),
                );
                candidates.push(exe_dir.join(&file_name));
            }
        }

        if let Ok(current_dir) = std::env::current_dir() {
            candidates.push(current_dir.join("env").join(&file_name));
            candidates.push(current_dir.join("env").join("bin").join(&file_name));
            candidates.push(
                current_dir
                    .join("env")
                    .join("ffmpeg")
                    .join("bin")
                    .join(&file_name),
            );
        }

        candidates
    }

    fn tool_file_name(stem: &str) -> String {
        if cfg!(windows) {
            format!("{}.exe", stem)
        } else {
            stem.to_string()
        }
    }

    fn command_works(command: &Path) -> bool {
        let mut process = Command::new(command);
        Self::background_command(&mut process)
            .arg("-version")
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .map(|status| status.success())
            .unwrap_or(false)
    }

    fn background_command(command: &mut Command) -> &mut Command {
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            const CREATE_NO_WINDOW: u32 = 0x08000000;
            command.creation_flags(CREATE_NO_WINDOW);
        }
        command
    }
}

impl Default for FfmpegExecutor {
    fn default() -> Self {
        Self {
            ffmpeg_path: Self::resolve_tool("ffmpeg"),
            ffprobe_path: Self::resolve_tool("ffprobe"),
        }
    }
}
