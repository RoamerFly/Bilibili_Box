pub(super) fn sanitize_path_component(input: &str) -> String {
    let sanitized: String = input
        .chars()
        .map(|ch| match ch {
            '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*' => '_',
            ch if ch.is_control() => '_',
            ch => ch,
        })
        .collect();

    let sanitized = sanitized.trim().trim_matches('.');
    let sanitized: String = sanitized.chars().take(120).collect();
    if sanitized.is_empty() {
        "untitled".to_string()
    } else {
        sanitized
    }
}

#[cfg(test)]
mod tests {
    use super::sanitize_path_component;

    #[test]
    fn download_path_component_is_safe_and_bounded() {
        assert_eq!(
            sanitize_path_component("标题: 第一/集?"),
            "标题_ 第一_集_"
        );
        assert_eq!(sanitize_path_component("..."), "untitled");
        assert_eq!(sanitize_path_component(&"a".repeat(121)).chars().count(), 120);
    }
}
