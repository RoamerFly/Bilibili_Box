/// 分片下载模块

/// 分片大小: 2MB
pub const CHUNK_SIZE: u64 = 2 * 1024 * 1024;

/// 分片信息
#[derive(Debug, Clone)]
pub struct ChunkInfo {
    pub index: usize,
    pub start: u64,
    pub end: u64,
    pub completed: bool,
}

impl ChunkInfo {
    /// 创建新的分片信息
    pub fn new(index: usize, start: u64, end: u64) -> Self {
        Self {
            index,
            start,
            end,
            completed: false,
        }
    }

    /// 获取分片大小
    pub fn size(&self) -> u64 {
        self.end - self.start + 1
    }
}

/// 计算分片列表
pub fn calculate_chunks(total_size: u64) -> Vec<ChunkInfo> {
    let mut chunks = Vec::new();
    let mut start = 0u64;
    let mut index = 0;

    while start < total_size {
        let end = std::cmp::min(start + CHUNK_SIZE - 1, total_size - 1);
        chunks.push(ChunkInfo::new(index, start, end));
        start = end + 1;
        index += 1;
    }

    chunks
}
